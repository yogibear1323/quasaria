//! # Quasaria leverage vault ("Warp" vault)
//!
//! Isolated-margin, oracle-priced synthetic positions settled in a single
//! collateral token (e.g. USDC SAC on testnet).
//!
//! * Users `deposit` collateral into a free balance, then `open_position`
//!   with `margin` and `leverage_bps` (10_000 = 1x). Leverage is capped by an
//!   admin setting which itself is capped by [`HARD_MAX_LEVERAGE_BPS`] (20x).
//! * Notional `size = margin * leverage`. PnL is linear in oracle price:
//!   `pnl = size * (price - entry) / entry` (negated for shorts).
//! * **Health factor** `HF = equity / (size * maintenance_margin)`, in bps.
//!   Anyone may `liquidate` a position with HF < 1.0 and receives a bonus
//!   (`liquidation_bonus_bps` of margin, capped by remaining equity).
//! * Counterparty: the vault's **liquidity reserve** (funded via
//!   `fund_liquidity`) pays trader profits and absorbs trader losses. Profit
//!   payouts are capped by the reserve — the vault can never pay unbacked PnL.
//! * **Bot delegation:** a user can authorise one `operator` (their bot key)
//!   that may open/close/set triggers for them, but can never withdraw.
//! * **On-chain SL/TP:** optional stop-loss / take-profit prices that any
//!   keeper can execute with `execute_trigger` once crossed.
//! * Opening fee (`open_fee_bps` of notional) goes to the reserve, minus the
//!   referral share credited to the trader's referrer (capped at
//!   [`MAX_REFERRAL_SHARE_BPS`] of the fee regardless of the registry).
//! * Oracle: Reflector-compatible `lastprice(Asset) -> Option<PriceData>`.
//!   Prices older than `max_price_age` (hard cap [`HARD_MAX_PRICE_AGE`]) or
//!   dated more than [`MAX_FUTURE_SKEW`] seconds in the future are rejected.
//!
//! ## Bounded storage (F-02)
//! Every position lives under its own key. Open positions are indexed by a
//! dense slot table (`OpenAt(slot) -> id`, `OpenSlot(id) -> slot`, swap-remove
//! on close), so no single ledger entry grows with the number of positions.
//! A per-user list is capped by `max_positions_per_user` (hard cap
//! [`HARD_MAX_POSITIONS_PER_USER`]) and the global count by
//! `max_open_positions` (hard cap [`HARD_MAX_OPEN_POSITIONS`]). A minimum
//! margin (`min_margin`) guarantees every position pays a non-zero fee and has
//! a non-zero maintenance requirement, so every position is liquidatable.
//!
//! ## Governance
//! Two-step admin transfer, guardian pause (blocks `deposit` and
//! `open_position`; withdraw / close / triggers / liquidations stay open) and
//! a timelock for `SetConfig`, `SetOracle`, `WithdrawLiquidity`, `Upgrade` and
//! `SetDelay` (see `quasaria-gov`).
#![no_std]

use quasaria_gov as gov;
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, Symbol, Vec,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria Warp leverage vault");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

pub const BPS: i128 = 10_000;
pub const HARD_MAX_LEVERAGE_BPS: u32 = 200_000; // 20x
/// Oracle prices can never be accepted if older than this (seconds).
pub const HARD_MAX_PRICE_AGE: u64 = 3_600;
/// Tolerated oracle clock skew for future-dated prices (seconds).
pub const MAX_FUTURE_SKEW: u64 = 60;
/// Smallest `min_margin` the admin may configure (0.1 unit at 7 decimals).
pub const MIN_MARGIN_FLOOR: i128 = 1_000_000;
pub const HARD_MAX_POSITIONS_PER_USER: u32 = 20;
pub const HARD_MAX_OPEN_POSITIONS: u32 = 10_000;
/// The vault never pays more than this share of a fee to a referrer.
pub const MAX_REFERRAL_SHARE_BPS: u32 = 5_000;
/// Max ids returned by one `open_position_ids_page` call.
pub const MAX_PAGE: u32 = 100;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    ZeroAmount = 1,
    InsufficientCollateral = 2,
    LeverageTooHigh = 3,
    LeverageTooLow = 4,
    MarketNotEnabled = 5,
    NoPrice = 6,
    StalePrice = 7,
    PositionNotFound = 8,
    NotAuthorized = 9,
    Healthy = 10,
    InsufficientLiquidity = 11,
    TriggerNotHit = 12,
    InvalidConfig = 13,
    FuturePrice = 14,
    BelowMinMargin = 15,
    TooManyUserPositions = 16,
    TooManyOpenPositions = 17,
}

/// Reflector-compatible asset identifier.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// Reflector-compatible price record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Client for Reflector (or the Quasaria mock oracle).
#[contractclient(name = "OracleClient")]
pub trait PriceOracle {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

#[contractclient(name = "ReferralClient")]
pub trait ReferralInterface {
    fn get_referrer(env: Env, user: Address) -> Option<Address>;
    fn share_bps(env: Env) -> u32;
    fn record_reward(env: Env, source: Address, referrer: Address, token: Address, amount: i128);
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub max_leverage_bps: u32,
    pub maintenance_margin_bps: u32,
    pub liquidation_bonus_bps: u32,
    pub open_fee_bps: u32,
    pub max_price_age: u64,
    /// Minimum margin per position (collateral units).
    pub min_margin: i128,
    /// Max simultaneously open positions per owner.
    pub max_positions_per_user: u32,
    /// Max simultaneously open positions in the whole vault.
    pub max_open_positions: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub id: u64,
    pub owner: Address,
    pub asset: Asset,
    pub is_long: bool,
    pub margin: i128,
    pub size: i128,
    pub entry_price: i128,
    pub opened_at: u64,
    /// 0 = unset
    pub stop_loss: i128,
    /// 0 = unset
    pub take_profit: i128,
}

/// Timelocked admin actions (`propose_action` → wait → `execute_action`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultAction {
    SetConfig(Config),
    SetOracle(Address),
    /// (to, amount) — withdraw from the counterparty reserve.
    WithdrawLiquidity(Address, i128),
    Upgrade(BytesN<32>),
    SetDelay(u64),
    SetGuardian(Address),
}

impl gov::TimelockAction for VaultAction {
    fn delay_class(&self) -> gov::DelayClass {
        match self {
            VaultAction::SetOracle(_)
            | VaultAction::WithdrawLiquidity(_, _)
            | VaultAction::Upgrade(_)
            | VaultAction::SetDelay(_) => gov::DelayClass::Critical,
            VaultAction::SetConfig(_) | VaultAction::SetGuardian(_) => gov::DelayClass::Standard,
        }
    }
    fn validate(&self, env: &Env) {
        match self {
            VaultAction::SetConfig(c) => validate_config(env, c),
            VaultAction::SetDelay(d) => gov::check_delay(env, *d),
            _ => {}
        }
    }
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Collateral,
    Oracle,
    Referral,
    Config,
    Liquidity,
    NextId,
    OpenCount,
    Free(Address),
    Operator(Address),
    Market(Asset),
    Position(u64),
    UserPositions(Address),
    OpenAt(u32),
    OpenSlot(u64),
}

#[contractevent(topics = ["pos_open"])]
pub struct PositionOpened {
    #[topic]
    pub owner: Address,
    pub id: u64,
    pub is_long: bool,
    pub margin: i128,
    pub size: i128,
    pub entry_price: i128,
}

#[contractevent(topics = ["pos_close"])]
pub struct PositionClosed {
    #[topic]
    pub owner: Address,
    pub id: u64,
    pub exit_price: i128,
    pub pnl: i128,
    pub payout: i128,
    pub reason: Symbol,
}

#[contractevent(topics = ["liquidated"])]
pub struct Liquidated {
    #[topic]
    pub owner: Address,
    pub id: u64,
    pub liquidator: Address,
    pub bonus: i128,
}

#[contractevent(topics = ["liq_funded"])]
pub struct LiquidityFunded {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["liq_withdrawn"])]
pub struct LiquidityWithdrawn {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["config_set"], data_format = "single-value")]
pub struct ConfigSet {
    pub config: Config,
}

#[contractevent(topics = ["oracle_set"], data_format = "single-value")]
pub struct OracleSet {
    pub oracle: Address,
}

#[contractevent(topics = ["market_set"], data_format = "single-value")]
pub struct MarketSet {
    #[topic]
    pub asset: Asset,
    pub enabled: bool,
}

// ------------------------------------------------------------- pure math

/// Signed PnL of a position at `price` (floored: rounding favours the vault).
pub fn pnl_at(env: &Env, is_long: bool, size: i128, entry: i128, price: i128) -> i128 {
    let diff = if is_long {
        gov::sub(env, price, entry)
    } else {
        gov::sub(env, entry, price)
    };
    gov::mul_div_floor(env, size, diff, entry)
}

/// Maintenance requirement, never below 1 unit for a non-empty position.
fn maintenance(env: &Env, size: i128, mm_bps: u32) -> i128 {
    let m = gov::mul_div_floor(env, size, i128::from(mm_bps), BPS);
    if m < 1 && size > 0 {
        1
    } else {
        m
    }
}

/// Health factor in bps (10_000 = 1.0).
pub fn health_factor_bps(env: &Env, margin: i128, size: i128, pnl: i128, mm_bps: u32) -> i128 {
    let equity = gov::add(env, margin, pnl);
    if equity <= 0 {
        return 0;
    }
    let maint = maintenance(env, size, mm_bps);
    if maint <= 0 {
        return i128::MAX;
    }
    gov::mul_div_floor(env, equity, BPS, maint)
}

/// Price at which HF hits 1.0 (for UI/bot display).
pub fn liquidation_price(
    env: &Env,
    is_long: bool,
    margin: i128,
    size: i128,
    entry: i128,
    mm_bps: u32,
) -> i128 {
    // equity = margin + size*(p-entry)/entry = size*mm  => solve for p
    let maint = maintenance(env, size, mm_bps);
    let delta = gov::mul_div_floor(env, gov::sub(env, margin, maint), entry, size);
    if is_long {
        gov::sub(env, entry, delta)
    } else {
        gov::add(env, entry, delta)
    }
}

// ------------------------------------------------------------- storage

fn bump_p(env: &Env, k: &DataKey) {
    gov::bump_persistent(env, k);
}

fn cfg(env: &Env) -> Config {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::InvalidConfig))
}

fn collateral(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Collateral)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::InvalidConfig))
}

fn get_free(env: &Env, u: &Address) -> i128 {
    let k = DataKey::Free(u.clone());
    let v = env.storage().persistent().get(&k).unwrap_or(0);
    bump_p(env, &k);
    v
}

fn set_free(env: &Env, u: &Address, v: i128) {
    let k = DataKey::Free(u.clone());
    env.storage().persistent().set(&k, &v);
    bump_p(env, &k);
}

fn liquidity(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::Liquidity).unwrap_or(0)
}

fn set_liquidity(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::Liquidity, &v);
}

fn load_position(env: &Env, id: u64) -> Position {
    let k = DataKey::Position(id);
    let p = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::PositionNotFound));
    bump_p(env, &k);
    p
}

fn save_position(env: &Env, pos: &Position) {
    let k = DataKey::Position(pos.id);
    env.storage().persistent().set(&k, pos);
    bump_p(env, &k);
}

fn user_list(env: &Env, owner: &Address) -> Vec<u64> {
    let k = DataKey::UserPositions(owner.clone());
    let v = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| Vec::new(env));
    bump_p(env, &k);
    v
}

fn put_user_list(env: &Env, owner: &Address, v: &Vec<u64>) {
    let k = DataKey::UserPositions(owner.clone());
    if v.is_empty() {
        env.storage().persistent().remove(&k);
    } else {
        env.storage().persistent().set(&k, v);
        bump_p(env, &k);
    }
}

fn open_count(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::OpenCount).unwrap_or(0)
}

/// Append `id` to the dense open-position index (O(1), bounded entries).
fn index_insert(env: &Env, id: u64) {
    let n = open_count(env);
    let st = env.storage().persistent();
    st.set(&DataKey::OpenAt(n), &id);
    st.set(&DataKey::OpenSlot(id), &n);
    bump_p(env, &DataKey::OpenAt(n));
    bump_p(env, &DataKey::OpenSlot(id));
    let next = n
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::TooManyOpenPositions));
    env.storage().instance().set(&DataKey::OpenCount, &next);
}

/// Swap-remove `id` from the open-position index (O(1)).
fn index_remove(env: &Env, id: u64) {
    let st = env.storage().persistent();
    let slot: u32 = match st.get(&DataKey::OpenSlot(id)) {
        Some(s) => s,
        None => return,
    };
    let n = open_count(env);
    let last = n.saturating_sub(1);
    if slot != last {
        let moved: u64 = st
            .get(&DataKey::OpenAt(last))
            .unwrap_or_else(|| panic_with_error!(env, VaultError::PositionNotFound));
        st.set(&DataKey::OpenAt(slot), &moved);
        st.set(&DataKey::OpenSlot(moved), &slot);
        bump_p(env, &DataKey::OpenAt(slot));
        bump_p(env, &DataKey::OpenSlot(moved));
    }
    st.remove(&DataKey::OpenAt(last));
    st.remove(&DataKey::OpenSlot(id));
    env.storage().instance().set(&DataKey::OpenCount, &last);
}

fn oracle_price(env: &Env, asset: &Asset) -> i128 {
    let oracle: Address = env
        .storage()
        .instance()
        .get(&DataKey::Oracle)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NoPrice));
    let pd = OracleClient::new(env, &oracle)
        .lastprice(asset)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NoPrice));
    check_price(env, &pd, cfg(env).max_price_age)
}

/// Validate an oracle record: positive, not future-dated beyond the skew
/// allowance, and not older than `max_age`.
pub fn check_price(env: &Env, pd: &PriceData, max_age: u64) -> i128 {
    let now = env.ledger().timestamp();
    if pd.price <= 0 {
        panic_with_error!(env, VaultError::NoPrice);
    }
    if pd.timestamp > gov::checked_add_u64(env, now, MAX_FUTURE_SKEW) {
        panic_with_error!(env, VaultError::FuturePrice);
    }
    if now.saturating_sub(pd.timestamp) > max_age {
        panic_with_error!(env, VaultError::StalePrice);
    }
    pd.price
}

fn require_controller(env: &Env, caller: &Address, owner: &Address) {
    caller.require_auth();
    if caller == owner {
        return;
    }
    let k = DataKey::Operator(owner.clone());
    let op: Option<Address> = env.storage().persistent().get(&k);
    if op.as_ref() != Some(caller) {
        panic_with_error!(env, VaultError::NotAuthorized);
    }
    bump_p(env, &k);
}

fn validate_config(env: &Env, c: &Config) {
    if c.max_leverage_bps < 10_000
        || c.max_leverage_bps > HARD_MAX_LEVERAGE_BPS
        || c.maintenance_margin_bps == 0
        || c.maintenance_margin_bps >= 5_000
        || c.liquidation_bonus_bps > 2_000
        || c.open_fee_bps > 100
        || c.max_price_age == 0
        || c.max_price_age > HARD_MAX_PRICE_AGE
        || c.min_margin < MIN_MARGIN_FLOOR
        || c.max_positions_per_user == 0
        || c.max_positions_per_user > HARD_MAX_POSITIONS_PER_USER
        || c.max_open_positions == 0
        || c.max_open_positions > HARD_MAX_OPEN_POSITIONS
    {
        panic_with_error!(env, VaultError::InvalidConfig);
    }
    // Maintenance must be below initial margin at max leverage, otherwise a
    // max-leverage position would be liquidatable at open.
    let initial_margin_bps = gov::div(env, BPS * BPS, i128::from(c.max_leverage_bps));
    if i128::from(c.maintenance_margin_bps) >= initial_margin_bps {
        panic_with_error!(env, VaultError::InvalidConfig);
    }
    // The smallest position (min margin at 1x) must pay a non-zero fee (if
    // fees are on) and have a non-zero maintenance requirement.
    let min_fee = gov::mul_div_floor(env, c.min_margin, i128::from(c.open_fee_bps), BPS);
    let min_maint = gov::mul_div_floor(env, c.min_margin, i128::from(c.maintenance_margin_bps), BPS);
    if (c.open_fee_bps > 0 && min_fee < 1) || min_maint < 1 {
        panic_with_error!(env, VaultError::InvalidConfig);
    }
}

/// Settle a position at `price`; returns (pnl, payout to owner equity).
fn settle(env: &Env, pos: &Position, price: i128) -> (i128, i128) {
    let pnl = pnl_at(env, pos.is_long, pos.size, pos.entry_price, price);
    let liq = liquidity(env);
    let payout = if pnl >= 0 {
        let profit = if pnl > liq { liq } else { pnl };
        set_liquidity(env, gov::sub(env, liq, profit));
        gov::add(env, pos.margin, profit)
    } else {
        let neg = gov::sub(env, 0, pnl);
        let loss = if neg > pos.margin { pos.margin } else { neg };
        set_liquidity(env, gov::add(env, liq, loss));
        gov::sub(env, pos.margin, loss)
    };
    (pnl, payout)
}

fn delete_position(env: &Env, pos: &Position) {
    env.storage().persistent().remove(&DataKey::Position(pos.id));
    let list = user_list(env, &pos.owner);
    let mut out = Vec::new(env);
    for x in list.iter() {
        if x != pos.id {
            out.push_back(x);
        }
    }
    put_user_list(env, &pos.owner, &out);
    index_remove(env, pos.id);
}

#[contract]
pub struct LeverageVault;

quasaria_gov::governance_entrypoints!(LeverageVault, VaultAction);
quasaria_gov::pause_entrypoints!(LeverageVault);

#[contractimpl]
impl LeverageVault {
    /// `timelock_delay`: seconds between `propose_action` and
    /// `execute_action` (≥ 60 s on testnet, ≥ 48 h enforced on mainnet).
    pub fn __constructor(
        env: Env,
        admin: Address,
        collateral: Address,
        oracle: Address,
        referral: Option<Address>,
        config: Config,
        timelock_delay: u64,
    ) {
        validate_config(&env, &config);
        gov::init(&env, &admin, timelock_delay);
        let st = env.storage().instance();
        st.set(&DataKey::Collateral, &collateral);
        st.set(&DataKey::Oracle, &oracle);
        st.set(&DataKey::Config, &config);
        st.set(&DataKey::Liquidity, &0i128);
        st.set(&DataKey::NextId, &1u64);
        st.set(&DataKey::OpenCount, &0u32);
        if let Some(r) = referral {
            st.set(&DataKey::Referral, &r);
        }
    }

    // ------------------------------------------------ admin

    /// Apply a queued timelocked action after its delay has elapsed.
    pub fn execute_action(env: Env, action: VaultAction) {
        gov::consume(&env, &action);
        match action {
            VaultAction::SetConfig(config) => {
                validate_config(&env, &config);
                env.storage().instance().set(&DataKey::Config, &config);
                ConfigSet { config }.publish(&env);
            }
            VaultAction::SetOracle(oracle) => {
                env.storage().instance().set(&DataKey::Oracle, &oracle);
                OracleSet { oracle }.publish(&env);
            }
            VaultAction::WithdrawLiquidity(to, amount) => {
                let liq = liquidity(&env);
                if amount <= 0 || amount > liq {
                    panic_with_error!(&env, VaultError::InsufficientLiquidity);
                }
                set_liquidity(&env, gov::sub(&env, liq, amount));
                token::Client::new(&env, &collateral(&env)).transfer(
                    &env.current_contract_address(),
                    &to,
                    &amount,
                );
                LiquidityWithdrawn { to, amount }.publish(&env);
            }
            VaultAction::Upgrade(hash) => gov::upgrade_now(&env, &hash),
            VaultAction::SetDelay(d) => gov::set_delay_now(&env, d),
            VaultAction::SetGuardian(g) => gov::set_guardian_now(&env, &g),
        }
    }

    /// Enable/disable a market (disabling only blocks new opens).
    pub fn set_market(env: Env, asset: Asset, enabled: bool) {
        gov::require_admin(&env);
        let k = DataKey::Market(asset.clone());
        if enabled {
            env.storage().persistent().set(&k, &true);
            bump_p(&env, &k);
        } else {
            env.storage().persistent().remove(&k);
        }
        MarketSet { asset, enabled }.publish(&env);
    }

    /// Fund the counterparty reserve (anyone can add). Withdrawals are
    /// admin-only **and** timelocked (`VaultAction::WithdrawLiquidity`).
    pub fn fund_liquidity(env: Env, from: Address, amount: i128) {
        from.require_auth();
        gov::bump_instance(&env);
        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        token::Client::new(&env, &collateral(&env)).transfer(
            &from,
            env.current_contract_address(),
            &amount,
        );
        set_liquidity(&env, gov::add(&env, liquidity(&env), amount));
        LiquidityFunded { from, amount }.publish(&env);
    }

    // ------------------------------------------------ user collateral

    /// Paused by the guardian.
    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        gov::bump_instance(&env);
        gov::when_not_paused(&env);
        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        token::Client::new(&env, &collateral(&env)).transfer(
            &user,
            env.current_contract_address(),
            &amount,
        );
        set_free(&env, &user, gov::add(&env, get_free(&env, &user), amount));
    }

    /// Only the owner (never the operator/bot) can withdraw. Never paused.
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();
        gov::bump_instance(&env);
        let free = get_free(&env, &user);
        if amount <= 0 || amount > free {
            panic_with_error!(&env, VaultError::InsufficientCollateral);
        }
        set_free(&env, &user, gov::sub(&env, free, amount));
        token::Client::new(&env, &collateral(&env)).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );
    }

    /// Authorise (or revoke with `None`) a bot key to trade for `user`.
    pub fn set_operator(env: Env, user: Address, operator: Option<Address>) {
        user.require_auth();
        gov::bump_instance(&env);
        let k = DataKey::Operator(user);
        match operator {
            Some(op) => {
                env.storage().persistent().set(&k, &op);
                bump_p(&env, &k);
            }
            None => env.storage().persistent().remove(&k),
        }
    }

    // ------------------------------------------------ trading

    /// Paused by the guardian.
    pub fn open_position(
        env: Env,
        caller: Address,
        owner: Address,
        asset: Asset,
        is_long: bool,
        margin: i128,
        leverage_bps: u32,
    ) -> u64 {
        require_controller(&env, &caller, &owner);
        gov::bump_instance(&env);
        gov::when_not_paused(&env);
        let c = cfg(&env);
        if margin <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        if margin < c.min_margin {
            panic_with_error!(&env, VaultError::BelowMinMargin);
        }
        if leverage_bps < 10_000 {
            panic_with_error!(&env, VaultError::LeverageTooLow);
        }
        if leverage_bps > c.max_leverage_bps {
            panic_with_error!(&env, VaultError::LeverageTooHigh);
        }
        let mk = DataKey::Market(asset.clone());
        if !env.storage().persistent().has(&mk) {
            panic_with_error!(&env, VaultError::MarketNotEnabled);
        }
        bump_p(&env, &mk);
        if open_count(&env) >= c.max_open_positions {
            panic_with_error!(&env, VaultError::TooManyOpenPositions);
        }
        let mut ul = user_list(&env, &owner);
        if ul.len() >= c.max_positions_per_user {
            panic_with_error!(&env, VaultError::TooManyUserPositions);
        }
        let size = gov::mul_div_floor(&env, margin, i128::from(leverage_bps), BPS);
        let fee = gov::mul_div_floor(&env, size, i128::from(c.open_fee_bps), BPS);
        let free = get_free(&env, &owner);
        let need = gov::add(&env, margin, fee);
        if free < need {
            panic_with_error!(&env, VaultError::InsufficientCollateral);
        }
        set_free(&env, &owner, gov::sub(&env, free, need));

        // Fee split: referral share -> referrer's free balance, rest -> reserve.
        // The share is capped here, whatever the registry returns.
        let mut to_reserve = fee;
        if let Some(reg) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Referral)
        {
            let rc = ReferralClient::new(&env, &reg);
            if let Some(referrer) = rc.get_referrer(&owner) {
                let share = rc.share_bps().min(MAX_REFERRAL_SHARE_BPS);
                let cut = gov::mul_div_floor(&env, fee, i128::from(share), BPS);
                if cut > 0 {
                    set_free(&env, &referrer, gov::add(&env, get_free(&env, &referrer), cut));
                    rc.record_reward(&env.current_contract_address(), &referrer, &collateral(&env), &cut);
                    to_reserve = gov::sub(&env, to_reserve, cut);
                }
            }
        }
        set_liquidity(&env, gov::add(&env, liquidity(&env), to_reserve));

        let price = oracle_price(&env, &asset);
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let next = id
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, VaultError::TooManyOpenPositions));
        env.storage().instance().set(&DataKey::NextId, &next);
        let pos = Position {
            id,
            owner: owner.clone(),
            asset,
            is_long,
            margin,
            size,
            entry_price: price,
            opened_at: env.ledger().timestamp(),
            stop_loss: 0,
            take_profit: 0,
        };
        save_position(&env, &pos);
        ul.push_back(id);
        put_user_list(&env, &owner, &ul);
        index_insert(&env, id);
        PositionOpened {
            owner,
            id,
            is_long,
            margin,
            size,
            entry_price: price,
        }
        .publish(&env);
        id
    }

    /// Risk-reducing; allowed while paused.
    pub fn set_triggers(env: Env, caller: Address, id: u64, stop_loss: i128, take_profit: i128) {
        let mut pos = load_position(&env, id);
        require_controller(&env, &caller, &pos.owner);
        gov::bump_instance(&env);
        pos.stop_loss = stop_loss;
        pos.take_profit = take_profit;
        save_position(&env, &pos);
    }

    /// Never paused.
    pub fn close_position(env: Env, caller: Address, id: u64) -> i128 {
        let pos = load_position(&env, id);
        require_controller(&env, &caller, &pos.owner);
        gov::bump_instance(&env);
        let price = oracle_price(&env, &pos.asset);
        Self::finish(&env, &pos, price, Symbol::new(&env, "user"))
    }

    /// Permissionless keeper entry point: close when SL or TP is crossed.
    pub fn execute_trigger(env: Env, id: u64) -> i128 {
        gov::bump_instance(&env);
        let pos = load_position(&env, id);
        let price = oracle_price(&env, &pos.asset);
        let sl_hit = pos.stop_loss > 0
            && ((pos.is_long && price <= pos.stop_loss) || (!pos.is_long && price >= pos.stop_loss));
        let tp_hit = pos.take_profit > 0
            && ((pos.is_long && price >= pos.take_profit)
                || (!pos.is_long && price <= pos.take_profit));
        if !sl_hit && !tp_hit {
            panic_with_error!(&env, VaultError::TriggerNotHit);
        }
        let reason = if sl_hit { "stop_loss" } else { "take_profit" };
        Self::finish(&env, &pos, price, Symbol::new(&env, reason))
    }

    /// Liquidate an unhealthy position (HF < 1.0). Liquidator receives a
    /// bonus paid out in collateral tokens. Never paused.
    pub fn liquidate(env: Env, liquidator: Address, id: u64) -> i128 {
        liquidator.require_auth();
        gov::bump_instance(&env);
        let pos = load_position(&env, id);
        let price = oracle_price(&env, &pos.asset);
        let c = cfg(&env);
        let pnl = pnl_at(&env, pos.is_long, pos.size, pos.entry_price, price);
        if health_factor_bps(&env, pos.margin, pos.size, pnl, c.maintenance_margin_bps) >= BPS {
            panic_with_error!(&env, VaultError::Healthy);
        }
        let eq = gov::add(&env, pos.margin, pnl);
        let equity = if eq > 0 { eq } else { 0 };
        let max_bonus = gov::mul_div_floor(&env, pos.margin, i128::from(c.liquidation_bonus_bps), BPS);
        let bonus = if equity < max_bonus { equity } else { max_bonus };
        let remainder = gov::sub(&env, equity, bonus);
        // Everything the trader lost (margin - equity) goes to the reserve.
        set_liquidity(
            &env,
            gov::add(&env, liquidity(&env), gov::sub(&env, pos.margin, equity)),
        );
        if remainder > 0 {
            set_free(&env, &pos.owner, gov::add(&env, get_free(&env, &pos.owner), remainder));
        }
        delete_position(&env, &pos);
        if bonus > 0 {
            token::Client::new(&env, &collateral(&env)).transfer(
                &env.current_contract_address(),
                &liquidator,
                &bonus,
            );
        }
        Liquidated {
            owner: pos.owner.clone(),
            id,
            liquidator,
            bonus,
        }
        .publish(&env);
        bonus
    }

    // ------------------------------------------------ views

    pub fn config(env: Env) -> Config {
        cfg(&env)
    }

    pub fn oracle(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Oracle)
            .unwrap_or_else(|| panic_with_error!(&env, VaultError::NoPrice))
    }

    pub fn free_collateral(env: Env, user: Address) -> i128 {
        get_free(&env, &user)
    }

    pub fn liquidity(env: Env) -> i128 {
        liquidity(&env)
    }

    pub fn operator(env: Env, user: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Operator(user))
    }

    pub fn position(env: Env, id: u64) -> Position {
        load_position(&env, id)
    }

    /// Open position ids of `user` (≤ `max_positions_per_user`).
    pub fn user_positions(env: Env, user: Address) -> Vec<u64> {
        user_list(&env, &user)
    }

    /// Number of open positions in the vault.
    pub fn open_position_count(env: Env) -> u32 {
        open_count(&env)
    }

    /// A page of open position ids (slots `start .. start+limit`, limit ≤
    /// [`MAX_PAGE`]). Order is not stable across closes (swap-remove).
    pub fn open_position_ids_page(env: Env, start: u32, limit: u32) -> Vec<u64> {
        let n = open_count(&env);
        let lim = limit.min(MAX_PAGE);
        let end = start.saturating_add(lim).min(n);
        let mut out = Vec::new(&env);
        let mut i = start;
        while i < end {
            if let Some(id) = env.storage().persistent().get::<DataKey, u64>(&DataKey::OpenAt(i)) {
                out.push_back(id);
            }
            i = i.saturating_add(1);
        }
        out
    }

    /// First page of open position ids (backwards-compatible helper; use
    /// `open_position_count` + `open_position_ids_page` to scan everything).
    pub fn open_position_ids(env: Env) -> Vec<u64> {
        Self::open_position_ids_page(env, 0, MAX_PAGE)
    }

    pub fn health_factor(env: Env, id: u64) -> i128 {
        let pos = load_position(&env, id);
        let price = oracle_price(&env, &pos.asset);
        let pnl = pnl_at(&env, pos.is_long, pos.size, pos.entry_price, price);
        health_factor_bps(&env, pos.margin, pos.size, pnl, cfg(&env).maintenance_margin_bps)
    }

    pub fn liquidation_price(env: Env, id: u64) -> i128 {
        let pos = load_position(&env, id);
        liquidation_price(
            &env,
            pos.is_long,
            pos.margin,
            pos.size,
            pos.entry_price,
            cfg(&env).maintenance_margin_bps,
        )
    }
}

impl LeverageVault {
    fn finish(env: &Env, pos: &Position, price: i128, reason: Symbol) -> i128 {
        let (pnl, payout) = settle(env, pos, price);
        set_free(env, &pos.owner, gov::add(env, get_free(env, &pos.owner), payout));
        delete_position(env, pos);
        PositionClosed {
            owner: pos.owner.clone(),
            id: pos.id,
            exit_price: price,
            pnl,
            payout,
            reason,
        }
        .publish(env);
        payout
    }
}

#[cfg(test)]
mod test;
