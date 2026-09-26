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
//!   referral share credited to the trader's referrer.
//! * Oracle: Reflector-compatible `lastprice(Asset) -> Option<PriceData>` with
//!   a staleness bound (`max_price_age`).
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, Env, Symbol, Vec,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria Warp leverage vault");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

pub const BPS: i128 = 10_000;
pub const HARD_MAX_LEVERAGE_BPS: u32 = 200_000; // 20x
const DAY_LEDGERS: u32 = 17_280;

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

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Collateral,
    Oracle,
    Referral,
    Config,
    Liquidity,
    NextId,
    Free(Address),
    Operator(Address),
    Market(Asset),
    Position(u64),
    UserPositions(Address),
    OpenIds,
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

// ------------------------------------------------------------- pure math

/// Signed PnL of a position at `price`.
pub fn pnl_at(is_long: bool, size: i128, entry: i128, price: i128) -> i128 {
    let diff = if is_long { price - entry } else { entry - price };
    size * diff / entry
}

/// Health factor in bps (10_000 = 1.0). `i128::MAX` if no maintenance req.
pub fn health_factor_bps(margin: i128, size: i128, pnl: i128, mm_bps: u32) -> i128 {
    let equity = margin + pnl;
    if equity <= 0 {
        return 0;
    }
    let maint = size * mm_bps as i128 / BPS;
    if maint == 0 {
        return i128::MAX;
    }
    equity * BPS / maint
}

/// Price at which HF hits 1.0 (for UI/bot display).
pub fn liquidation_price(is_long: bool, margin: i128, size: i128, entry: i128, mm_bps: u32) -> i128 {
    // equity = margin + size*(p-entry)/entry = size*mm  => solve for p
    let maint = size * mm_bps as i128 / BPS;
    let delta = (margin - maint) * entry / size;
    if is_long {
        entry - delta
    } else {
        entry + delta
    }
}

// ------------------------------------------------------------- storage

fn cfg(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn get_free(env: &Env, u: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Free(u.clone()))
        .unwrap_or(0)
}

fn set_free(env: &Env, u: &Address, v: i128) {
    let k = DataKey::Free(u.clone());
    env.storage().persistent().set(&k, &v);
    env.storage()
        .persistent()
        .extend_ttl(&k, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
}

fn liquidity(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::Liquidity).unwrap_or(0)
}

fn set_liquidity(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::Liquidity, &v);
}

fn load_position(env: &Env, id: u64) -> Position {
    env.storage()
        .persistent()
        .get(&DataKey::Position(id))
        .unwrap_or_else(|| panic_with_error!(env, VaultError::PositionNotFound))
}

fn id_list(env: &Env, key: &DataKey) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(key)
        .unwrap_or_else(|| Vec::new(env))
}

fn put_list(env: &Env, key: &DataKey, v: &Vec<u64>) {
    env.storage().persistent().set(key, v);
    env.storage()
        .persistent()
        .extend_ttl(key, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
}

fn remove_id(env: &Env, key: &DataKey, id: u64) {
    let list = id_list(env, key);
    let mut out = Vec::new(env);
    for x in list.iter() {
        if x != id {
            out.push_back(x);
        }
    }
    put_list(env, key, &out);
}

fn oracle_price(env: &Env, asset: &Asset) -> i128 {
    let oracle: Address = env.storage().instance().get(&DataKey::Oracle).unwrap();
    let pd = OracleClient::new(env, &oracle)
        .lastprice(asset)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NoPrice));
    let now = env.ledger().timestamp();
    if pd.price <= 0 {
        panic_with_error!(env, VaultError::NoPrice);
    }
    if now > pd.timestamp && now - pd.timestamp > cfg(env).max_price_age {
        panic_with_error!(env, VaultError::StalePrice);
    }
    pd.price
}

fn require_controller(env: &Env, caller: &Address, owner: &Address) {
    caller.require_auth();
    if caller == owner {
        return;
    }
    let op: Option<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Operator(owner.clone()));
    if op.as_ref() != Some(caller) {
        panic_with_error!(env, VaultError::NotAuthorized);
    }
}

fn validate_config(env: &Env, c: &Config) {
    if c.max_leverage_bps < BPS as u32
        || c.max_leverage_bps > HARD_MAX_LEVERAGE_BPS
        || c.maintenance_margin_bps == 0
        || c.maintenance_margin_bps >= 5_000
        || c.liquidation_bonus_bps > 2_000
        || c.open_fee_bps > 100
    {
        panic_with_error!(env, VaultError::InvalidConfig);
    }
    // Maintenance must be below initial margin at max leverage, otherwise a
    // max-leverage position would be liquidatable at open.
    let initial_margin_bps = BPS * BPS / c.max_leverage_bps as i128;
    if c.maintenance_margin_bps as i128 >= initial_margin_bps {
        panic_with_error!(env, VaultError::InvalidConfig);
    }
}

/// Settle a position at `price`; returns (pnl, payout to owner equity).
fn settle(env: &Env, pos: &Position, price: i128) -> (i128, i128) {
    let pnl = pnl_at(pos.is_long, pos.size, pos.entry_price, price);
    let liq = liquidity(env);
    let payout;
    if pnl >= 0 {
        let profit = if pnl > liq { liq } else { pnl };
        set_liquidity(env, liq - profit);
        payout = pos.margin + profit;
    } else {
        let loss = if -pnl > pos.margin { pos.margin } else { -pnl };
        set_liquidity(env, liq + loss);
        payout = pos.margin - loss;
    }
    (pnl, payout)
}

fn delete_position(env: &Env, pos: &Position) {
    env.storage().persistent().remove(&DataKey::Position(pos.id));
    remove_id(env, &DataKey::UserPositions(pos.owner.clone()), pos.id);
    remove_id(env, &DataKey::OpenIds, pos.id);
}

#[contract]
pub struct LeverageVault;

#[contractimpl]
impl LeverageVault {
    pub fn __constructor(
        env: Env,
        admin: Address,
        collateral: Address,
        oracle: Address,
        referral: Option<Address>,
        config: Config,
    ) {
        validate_config(&env, &config);
        let st = env.storage().instance();
        st.set(&DataKey::Admin, &admin);
        st.set(&DataKey::Collateral, &collateral);
        st.set(&DataKey::Oracle, &oracle);
        st.set(&DataKey::Config, &config);
        st.set(&DataKey::Liquidity, &0i128);
        st.set(&DataKey::NextId, &1u64);
        if let Some(r) = referral {
            st.set(&DataKey::Referral, &r);
        }
    }

    // ------------------------------------------------ admin

    fn admin(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_config(env: Env, config: Config) {
        Self::admin(&env).require_auth();
        validate_config(&env, &config);
        env.storage().instance().set(&DataKey::Config, &config);
    }

    pub fn set_oracle(env: Env, oracle: Address) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Oracle, &oracle);
    }

    pub fn set_market(env: Env, asset: Asset, enabled: bool) {
        Self::admin(&env).require_auth();
        let k = DataKey::Market(asset);
        if enabled {
            env.storage().persistent().set(&k, &true);
            env.storage()
                .persistent()
                .extend_ttl(&k, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
        } else {
            env.storage().persistent().remove(&k);
        }
    }

    /// Fund the counterparty reserve (anyone can add; only admin removes).
    pub fn fund_liquidity(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        let col: Address = env.storage().instance().get(&DataKey::Collateral).unwrap();
        token::Client::new(&env, &col).transfer(&from, &env.current_contract_address(), &amount);
        set_liquidity(&env, liquidity(&env) + amount);
    }

    pub fn withdraw_liquidity(env: Env, to: Address, amount: i128) {
        Self::admin(&env).require_auth();
        let liq = liquidity(&env);
        if amount <= 0 || amount > liq {
            panic_with_error!(&env, VaultError::InsufficientLiquidity);
        }
        set_liquidity(&env, liq - amount);
        let col: Address = env.storage().instance().get(&DataKey::Collateral).unwrap();
        token::Client::new(&env, &col).transfer(&env.current_contract_address(), &to, &amount);
    }

    // ------------------------------------------------ user collateral

    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        let col: Address = env.storage().instance().get(&DataKey::Collateral).unwrap();
        token::Client::new(&env, &col).transfer(&user, &env.current_contract_address(), &amount);
        set_free(&env, &user, get_free(&env, &user) + amount);
    }

    /// Only the owner (never the operator/bot) can withdraw.
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();
        let free = get_free(&env, &user);
        if amount <= 0 || amount > free {
            panic_with_error!(&env, VaultError::InsufficientCollateral);
        }
        set_free(&env, &user, free - amount);
        let col: Address = env.storage().instance().get(&DataKey::Collateral).unwrap();
        token::Client::new(&env, &col).transfer(&env.current_contract_address(), &user, &amount);
    }

    /// Authorise (or revoke with `None`) a bot key to trade for `user`.
    pub fn set_operator(env: Env, user: Address, operator: Option<Address>) {
        user.require_auth();
        let k = DataKey::Operator(user);
        match operator {
            Some(op) => {
                env.storage().persistent().set(&k, &op);
                env.storage()
                    .persistent()
                    .extend_ttl(&k, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
            }
            None => env.storage().persistent().remove(&k),
        }
    }

    // ------------------------------------------------ trading

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
        let c = cfg(&env);
        if margin <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        if leverage_bps < BPS as u32 {
            panic_with_error!(&env, VaultError::LeverageTooLow);
        }
        if leverage_bps > c.max_leverage_bps {
            panic_with_error!(&env, VaultError::LeverageTooHigh);
        }
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Market(asset.clone()))
        {
            panic_with_error!(&env, VaultError::MarketNotEnabled);
        }
        let size = margin * leverage_bps as i128 / BPS;
        let fee = size * c.open_fee_bps as i128 / BPS;
        let free = get_free(&env, &owner);
        if free < margin + fee {
            panic_with_error!(&env, VaultError::InsufficientCollateral);
        }
        set_free(&env, &owner, free - margin - fee);

        // Fee split: referral share -> referrer's free balance, rest -> reserve.
        let mut to_reserve = fee;
        if let Some(reg) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Referral)
        {
            let rc = ReferralClient::new(&env, &reg);
            if let Some(referrer) = rc.get_referrer(&owner) {
                let cut = fee * rc.share_bps() as i128 / BPS;
                if cut > 0 {
                    set_free(&env, &referrer, get_free(&env, &referrer) + cut);
                    let col: Address =
                        env.storage().instance().get(&DataKey::Collateral).unwrap();
                    rc.record_reward(&env.current_contract_address(), &referrer, &col, &cut);
                    to_reserve -= cut;
                }
            }
        }
        set_liquidity(&env, liquidity(&env) + to_reserve);

        let price = oracle_price(&env, &asset);
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap();
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
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
        let k = DataKey::Position(id);
        env.storage().persistent().set(&k, &pos);
        env.storage()
            .persistent()
            .extend_ttl(&k, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
        let uk = DataKey::UserPositions(owner.clone());
        let mut ul = id_list(&env, &uk);
        ul.push_back(id);
        put_list(&env, &uk, &ul);
        let mut open = id_list(&env, &DataKey::OpenIds);
        open.push_back(id);
        put_list(&env, &DataKey::OpenIds, &open);
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

    pub fn set_triggers(env: Env, caller: Address, id: u64, stop_loss: i128, take_profit: i128) {
        let mut pos = load_position(&env, id);
        require_controller(&env, &caller, &pos.owner);
        pos.stop_loss = stop_loss;
        pos.take_profit = take_profit;
        env.storage().persistent().set(&DataKey::Position(id), &pos);
    }

    pub fn close_position(env: Env, caller: Address, id: u64) -> i128 {
        let pos = load_position(&env, id);
        require_controller(&env, &caller, &pos.owner);
        let price = oracle_price(&env, &pos.asset);
        Self::finish(&env, &pos, price, Symbol::new(&env, "user"))
    }

    /// Permissionless keeper entry point: close when SL or TP is crossed.
    pub fn execute_trigger(env: Env, id: u64) -> i128 {
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
    /// bonus paid out in collateral tokens.
    pub fn liquidate(env: Env, liquidator: Address, id: u64) -> i128 {
        liquidator.require_auth();
        let pos = load_position(&env, id);
        let price = oracle_price(&env, &pos.asset);
        let c = cfg(&env);
        let pnl = pnl_at(pos.is_long, pos.size, pos.entry_price, price);
        if health_factor_bps(pos.margin, pos.size, pnl, c.maintenance_margin_bps) >= BPS {
            panic_with_error!(&env, VaultError::Healthy);
        }
        let equity = if pos.margin + pnl > 0 {
            pos.margin + pnl
        } else {
            0
        };
        let max_bonus = pos.margin * c.liquidation_bonus_bps as i128 / BPS;
        let bonus = if equity < max_bonus { equity } else { max_bonus };
        let remainder = equity - bonus;
        // Everything the trader lost (margin - equity) goes to the reserve.
        set_liquidity(&env, liquidity(&env) + (pos.margin - equity));
        if remainder > 0 {
            set_free(&env, &pos.owner, get_free(&env, &pos.owner) + remainder);
        }
        delete_position(&env, &pos);
        if bonus > 0 {
            let col: Address = env.storage().instance().get(&DataKey::Collateral).unwrap();
            token::Client::new(&env, &col).transfer(
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

    pub fn user_positions(env: Env, user: Address) -> Vec<u64> {
        id_list(&env, &DataKey::UserPositions(user))
    }

    /// All open position ids (used by the liquidation keeper).
    pub fn open_position_ids(env: Env) -> Vec<u64> {
        id_list(&env, &DataKey::OpenIds)
    }

    pub fn health_factor(env: Env, id: u64) -> i128 {
        let pos = load_position(&env, id);
        let price = oracle_price(&env, &pos.asset);
        let pnl = pnl_at(pos.is_long, pos.size, pos.entry_price, price);
        health_factor_bps(pos.margin, pos.size, pnl, cfg(&env).maintenance_margin_bps)
    }

    pub fn liquidation_price(env: Env, id: u64) -> i128 {
        let pos = load_position(&env, id);
        liquidation_price(
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
        set_free(env, &pos.owner, get_free(env, &pos.owner) + payout);
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
