//! # Quasaria lending pool (testnet-only, unaudited)
//!
//! A single Soroban contract holding many **reserves** (one per asset, keyed
//! by the asset's Stellar Asset Contract address). Compound / Aave-v2-lite:
//!
//! * **Supply** earns interest through a per-reserve `supply_index`
//!   (index-based accounting: users hold *scaled* balances, the underlying
//!   amount is `scaled * index / SCALE`). **Borrow** debt grows through a
//!   per-reserve `borrow_index`. Every rounding step favours the protocol:
//!   scaled supply is minted with floor and burned with ceil, scaled debt is
//!   minted with ceil and burned with floor, debt is valued with ceil and
//!   collateral with floor.
//! * **Kinked interest-rate model** per reserve: `base + slope1 * U / U_opt`
//!   below the optimal utilisation, `+ slope2 * (U - U_opt) / (1 - U_opt)`
//!   above it. A `reserve_factor` share of interest accrues to the treasury.
//! * **Health factor** `HF = Σ collateral_usd * liq_threshold / Σ debt_usd`
//!   over the user's (bounded) reserve list with oracle prices. Borrowing
//!   needs the LTV-weighted borrow limit to cover the debt; withdrawals and
//!   collateral toggles are blocked if HF would drop below 1.
//! * **Liquidation** when HF < 1: the liquidator repays up to the close
//!   factor (50 %) of one debt reserve (the whole debt only when it is below
//!   the dust threshold) and seizes collateral worth `repay * (1 + bonus)`.
//!   When a borrower has no supply left but still owes, the debt is written
//!   off: the treasury of that reserve covers what it can and the rest is
//!   recorded as `bad_debt` (anyone can `cover_bad_debt`).
//! * **Dust limits** (lesson F-02): per-reserve `min_supply` / `min_borrow`;
//!   positions may never be left below them (except exactly 0).
//! * **Bounded storage** (F-02): one key per (user, reserve), at most
//!   `max_user_reserves` reserves per user, `MAX_RESERVES` reserves, and a
//!   capped, paged borrower index for keepers (no loops over users).
//! * **Oracle** (F-07): SEP-40 / Reflector `lastprice(Asset::Stellar(sac))`;
//!   rejects non-positive, stale (> `max_price_age`) and future-dated prices.
//! * **Governance** (`quasaria-gov`): two-step admin, guardian pause (never
//!   blocks repay, liquidation, or HF-safe withdrawals), timelocked oracle /
//!   global config / reserve config / treasury withdrawal / upgrade / delay.
//!   Only strictly risk-reducing reserve changes are immediate.
//! * All token movement goes through each asset's SAC via the SEP-41
//!   `token::Client` interface.
#![no_std]

use quasaria_gov as gov;
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, Symbol, Vec,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria lending pool");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

pub const BPS: i128 = 10_000;
/// Fixed-point scale of the supply / borrow indices.
pub const SCALE: i128 = 1_000_000_000_000;
/// Health-factor scale (1.0 = 10_000_000).
pub const HF_ONE: i128 = 10_000_000;
pub const YEAR: i128 = 31_536_000;
pub const MAX_RESERVES: u32 = 64;
pub const HARD_MAX_USER_RESERVES: u32 = 10;
pub const HARD_MAX_BORROWERS: u32 = 100_000;
pub const HARD_MAX_PRICE_AGE: u64 = 3_600;
pub const MAX_FUTURE_SKEW: u64 = 60;
pub const MAX_PAGE: u32 = 100;
/// Hard caps on reserve parameters.
pub const MAX_LIQ_THRESHOLD_BPS: u32 = 9_499; // < 95 %
pub const MAX_LIQ_BONUS_BPS: u32 = 1_000; // 10 %
pub const MAX_RESERVE_FACTOR_BPS: u32 = 5_000;
pub const MAX_BASE_RATE_BPS: u32 = 2_000;
pub const MAX_SLOPE1_BPS: u32 = 5_000;
pub const MAX_SLOPE2_BPS: u32 = 50_000;
pub const MIN_OPTIMAL_UTIL_BPS: u32 = 1_000;
pub const MAX_OPTIMAL_UTIL_BPS: u32 = 9_500;
pub const MAX_CLOSE_FACTOR_BPS: u32 = 5_000;
pub const MIN_CLOSE_FACTOR_BPS: u32 = 1_000;
/// Smallest allowed `min_borrow` / `min_supply` (raw token units).
pub const MIN_DUST_FLOOR: i128 = 1_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum LendError {
    ZeroAmount = 1,
    InvalidConfig = 2,
    ReserveExists = 3,
    ReserveNotFound = 4,
    TooManyReserves = 5,
    TooManyUserReserves = 6,
    BelowMinSupply = 7,
    BelowMinBorrow = 8,
    SupplyCapExceeded = 9,
    BorrowCapExceeded = 10,
    NotBorrowable = 11,
    NotCollateral = 12,
    InsufficientCollateral = 13,
    HealthFactorTooLow = 14,
    InsufficientLiquidity = 15,
    InsufficientBalance = 16,
    NoPrice = 17,
    StalePrice = 18,
    FuturePrice = 19,
    Healthy = 20,
    NoDebt = 21,
    NothingToSeize = 22,
    TooManyBorrowers = 23,
    NotRiskReducing = 24,
    NotBadDebt = 25,
    DustRemaining = 26,
    MainnetListing = 27,
}

/// Reflector / SEP-40 asset identifier.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// Reflector / SEP-40 price record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// SEP-40 subset used by the pool (Reflector or the Quasaria mock oracle).
#[contractclient(name = "OracleClient")]
pub trait PriceOracle {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

/// Pool-wide parameters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolConfig {
    /// Oracle prices older than this are rejected (seconds, ≤ 1 h).
    pub max_price_age: u64,
    /// Max share of one debt reserve a single liquidation may repay.
    pub close_factor_bps: u32,
    /// A debt reserve worth ≤ this (USD, oracle decimals) may be closed in full.
    pub close_dust_usd: i128,
    /// Max reserves (supplied or borrowed) per user.
    pub max_user_reserves: u32,
    /// Max accounts with open debt (bounded keeper index).
    pub max_borrowers: u32,
}

/// Per-reserve risk and rate parameters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveConfig {
    pub decimals: u32,
    /// Borrow power per unit of collateral value (collateral factor / LTV).
    pub ltv_bps: u32,
    pub liq_threshold_bps: u32,
    pub liq_bonus_bps: u32,
    pub reserve_factor_bps: u32,
    /// Total supply cap (raw units).
    pub supply_cap: i128,
    /// Total borrow cap (raw units, 0 when not borrowable).
    pub borrow_cap: i128,
    pub min_supply: i128,
    pub min_borrow: i128,
    pub collateral_enabled: bool,
    pub borrowable: bool,
    pub base_rate_bps: u32,
    pub slope1_bps: u32,
    pub optimal_util_bps: u32,
    pub slope2_bps: u32,
}

/// Per-reserve accounting.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveState {
    pub supply_index: i128,
    pub borrow_index: i128,
    pub scaled_supply: i128,
    pub scaled_debt: i128,
    /// Tokens held for this reserve (tracked; donations are ignored).
    pub cash: i128,
    /// Reserve-factor share of interest owed to the protocol (raw units).
    pub treasury: i128,
    /// Unrecoverable debt written off (raw units, cumulative, net of covers).
    pub bad_debt: i128,
    pub last_update: u64,
}

/// A user's position in one reserve.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserPosition {
    pub scaled_supply: i128,
    pub scaled_debt: i128,
    pub collateral: bool,
}

/// Read-only reserve summary.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveView {
    pub asset: Address,
    pub config: ReserveConfig,
    pub state: ReserveState,
    pub total_supply: i128,
    pub total_debt: i128,
    pub utilization_bps: i128,
    pub borrow_rate_bps: i128,
    pub supply_rate_bps: i128,
}

/// Read-only user position in one reserve.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserReserveView {
    pub asset: Address,
    pub supplied: i128,
    pub borrowed: i128,
    pub collateral: bool,
}

/// Account totals (USD with oracle decimals; HF with `HF_ONE` scale).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccountData {
    pub collateral_usd: i128,
    pub borrow_limit_usd: i128,
    pub liq_threshold_usd: i128,
    pub debt_usd: i128,
    /// `i128::MAX` when there is no debt.
    pub health_factor: i128,
}

/// Timelocked admin actions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LendingAction {
    SetOracle(Address),
    SetPoolConfig(PoolConfig),
    SetReserveConfig(Address, ReserveConfig),
    /// (asset, to, amount): withdraw accrued treasury.
    WithdrawTreasury(Address, Address, i128),
    Upgrade(BytesN<32>),
    SetDelay(u64),
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Oracle,
    OracleDecimals,
    Config,
    Reserves,
    ResCfg(Address),
    ResState(Address),
    Pos(Address, Address),
    UserAssets(Address),
    BorrowerCount,
    BorrowerAt(u32),
    BorrowerSlot(Address),
}

// ------------------------------------------------------------------ events

#[contractevent(topics = ["supply"])]
pub struct Supplied {
    #[topic]
    pub user: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
}

#[contractevent(topics = ["withdraw"])]
pub struct Withdrawn {
    #[topic]
    pub user: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
}

#[contractevent(topics = ["borrow"])]
pub struct Borrowed {
    #[topic]
    pub user: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
}

#[contractevent(topics = ["repay"])]
pub struct Repaid {
    #[topic]
    pub user: Address,
    #[topic]
    pub asset: Address,
    pub payer: Address,
    pub amount: i128,
}

#[contractevent(topics = ["collateral"])]
pub struct CollateralSet {
    #[topic]
    pub user: Address,
    #[topic]
    pub asset: Address,
    pub enabled: bool,
}

#[contractevent(topics = ["liquidate"])]
pub struct Liquidated {
    #[topic]
    pub borrower: Address,
    #[topic]
    pub liquidator: Address,
    pub debt_asset: Address,
    pub collateral_asset: Address,
    pub repaid: i128,
    pub seized: i128,
}

#[contractevent(topics = ["bad_debt"])]
pub struct BadDebt {
    #[topic]
    pub borrower: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
    pub covered_by_treasury: i128,
}

#[contractevent(topics = ["bad_debt_covered"])]
pub struct BadDebtCovered {
    #[topic]
    pub asset: Address,
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["reserve_set"])]
pub struct ReserveSet {
    #[topic]
    pub asset: Address,
    pub config: ReserveConfig,
}

#[contractevent(topics = ["pool_config_set"], data_format = "single-value")]
pub struct PoolConfigSet {
    pub config: PoolConfig,
}

#[contractevent(topics = ["oracle_set"], data_format = "single-value")]
pub struct OracleSet {
    pub oracle: Address,
}

#[contractevent(topics = ["treasury_withdrawn"])]
pub struct TreasuryWithdrawn {
    #[topic]
    pub asset: Address,
    pub to: Address,
    pub amount: i128,
}

// ------------------------------------------------------------------ pure math

fn pow10(env: &Env, d: u32) -> i128 {
    10i128
        .checked_pow(d)
        .unwrap_or_else(|| panic_with_error!(env, LendError::InvalidConfig))
}

/// Utilisation in bps: debt / (cash + debt), floor.
pub fn utilization_bps(env: &Env, cash: i128, debt: i128) -> i128 {
    if debt <= 0 {
        return 0;
    }
    let u = gov::mul_div_floor(env, debt, BPS, gov::add(env, cash, debt));
    if u > BPS {
        BPS
    } else {
        u
    }
}

/// Kinked annual borrow rate (bps) at utilisation `u` (bps).
pub fn borrow_rate_bps(env: &Env, c: &ReserveConfig, u: i128) -> i128 {
    let base = i128::from(c.base_rate_bps);
    let s1 = i128::from(c.slope1_bps);
    let s2 = i128::from(c.slope2_bps);
    let opt = i128::from(c.optimal_util_bps);
    if u <= opt {
        gov::add(env, base, gov::mul_div_ceil(env, s1, u, opt))
    } else {
        let excess = gov::sub(env, u, opt);
        let room = gov::sub(env, BPS, opt);
        gov::add(env, gov::add(env, base, s1), gov::mul_div_ceil(env, s2, excess, room))
    }
}

/// Annual supply rate (bps) = borrow rate × U × (1 − reserve factor), floor.
pub fn supply_rate_bps(env: &Env, c: &ReserveConfig, u: i128) -> i128 {
    let br = borrow_rate_bps(env, c, u);
    let net = gov::sub(env, BPS, i128::from(c.reserve_factor_bps));
    gov::mul_div_floor(env, gov::mul_div_floor(env, br, u, BPS), net, BPS)
}

pub fn supply_balance(env: &Env, scaled: i128, index: i128) -> i128 {
    gov::mul_div_floor(env, scaled, index, SCALE)
}

pub fn debt_balance(env: &Env, scaled: i128, index: i128) -> i128 {
    gov::mul_div_ceil(env, scaled, index, SCALE)
}

/// Accrue interest on `st` up to `now` (pure: caller persists).
pub fn accrue(env: &Env, c: &ReserveConfig, st: &mut ReserveState, now: u64) {
    if now <= st.last_update {
        return;
    }
    let dt = i128::from(now.saturating_sub(st.last_update));
    st.last_update = now;
    if st.scaled_debt <= 0 {
        return;
    }
    let debt_old = debt_balance(env, st.scaled_debt, st.borrow_index);
    let u = utilization_bps(env, st.cash, debt_old);
    let rate = borrow_rate_bps(env, c, u);
    let growth = gov::mul_div_ceil(env, st.borrow_index, gov::mul(env, rate, dt), gov::mul(env, BPS, YEAR));
    st.borrow_index = gov::add(env, st.borrow_index, growth);
    let debt_new = debt_balance(env, st.scaled_debt, st.borrow_index);
    let interest = gov::sub(env, debt_new, debt_old);
    if interest <= 0 {
        return;
    }
    let to_treasury = gov::mul_div_ceil(env, interest, i128::from(c.reserve_factor_bps), BPS);
    let to_suppliers = gov::sub(env, interest, to_treasury);
    if st.scaled_supply > 0 && to_suppliers > 0 {
        let inc = gov::mul_div_floor(env, to_suppliers, SCALE, st.scaled_supply);
        st.supply_index = gov::add(env, st.supply_index, inc);
        st.treasury = gov::add(env, st.treasury, to_treasury);
    } else {
        st.treasury = gov::add(env, st.treasury, interest);
    }
}

/// USD value (oracle decimals) of `amount` raw units at `price`, floor or ceil.
pub fn usd_value(env: &Env, amount: i128, price: i128, decimals: u32, ceil: bool) -> i128 {
    if ceil {
        gov::mul_div_ceil(env, amount, price, pow10(env, decimals))
    } else {
        gov::mul_div_floor(env, amount, price, pow10(env, decimals))
    }
}

/// HF from threshold-weighted collateral and debt (`i128::MAX` without debt).
pub fn health_factor(env: &Env, liq_threshold_usd: i128, debt_usd: i128) -> i128 {
    if debt_usd <= 0 {
        return i128::MAX;
    }
    gov::mul_div_floor(env, liq_threshold_usd, HF_ONE, debt_usd)
}

pub fn validate_pool_config(env: &Env, c: &PoolConfig) {
    if c.max_price_age == 0
        || c.max_price_age > HARD_MAX_PRICE_AGE
        || c.close_factor_bps < MIN_CLOSE_FACTOR_BPS
        || c.close_factor_bps > MAX_CLOSE_FACTOR_BPS
        || c.close_dust_usd < 0
        || c.max_user_reserves == 0
        || c.max_user_reserves > HARD_MAX_USER_RESERVES
        || c.max_borrowers == 0
        || c.max_borrowers > HARD_MAX_BORROWERS
    {
        panic_with_error!(env, LendError::InvalidConfig);
    }
}

pub fn validate_reserve_config(env: &Env, c: &ReserveConfig) {
    let bad = c.decimals > 18
        || c.ltv_bps > c.liq_threshold_bps
        || c.liq_threshold_bps > MAX_LIQ_THRESHOLD_BPS
        || c.liq_bonus_bps > MAX_LIQ_BONUS_BPS
        || c.reserve_factor_bps > MAX_RESERVE_FACTOR_BPS
        || c.supply_cap <= 0
        || c.borrow_cap < 0
        || c.borrow_cap > c.supply_cap
        || c.min_supply < MIN_DUST_FLOOR
        || c.min_borrow < MIN_DUST_FLOOR
        || c.min_supply > c.supply_cap
        || c.base_rate_bps > MAX_BASE_RATE_BPS
        || c.slope1_bps > MAX_SLOPE1_BPS
        || c.slope2_bps > MAX_SLOPE2_BPS
        || c.optimal_util_bps < MIN_OPTIMAL_UTIL_BPS
        || c.optimal_util_bps > MAX_OPTIMAL_UTIL_BPS
        // collateral needs a threshold and a bonus; LTV only if enabled
        || (c.collateral_enabled && (c.liq_threshold_bps == 0 || c.liq_bonus_bps == 0))
        || (!c.collateral_enabled && c.ltv_bps != 0)
        || (c.borrowable && c.borrow_cap == 0);
    if bad {
        panic_with_error!(env, LendError::InvalidConfig);
    }
    // threshold × (1 + bonus) must stay below 100 %: a liquidation must never
    // seize more collateral value than it leaves the position able to cover.
    let t = i128::from(c.liq_threshold_bps);
    let b = gov::add(env, BPS, i128::from(c.liq_bonus_bps));
    if gov::mul(env, t, b) >= gov::mul(env, BPS, BPS) {
        panic_with_error!(env, LendError::InvalidConfig);
    }
}

/// True if `new` only reduces risk versus `old` (safe to apply immediately).
pub fn is_risk_reducing(old: &ReserveConfig, new: &ReserveConfig) -> bool {
    new.decimals == old.decimals
        && new.ltv_bps <= old.ltv_bps
        && new.liq_threshold_bps == old.liq_threshold_bps
        && new.liq_bonus_bps == old.liq_bonus_bps
        && new.reserve_factor_bps == old.reserve_factor_bps
        && new.supply_cap <= old.supply_cap
        && new.borrow_cap <= old.borrow_cap
        && new.min_supply == old.min_supply
        && new.min_borrow == old.min_borrow
        && (old.collateral_enabled || !new.collateral_enabled)
        && (old.borrowable || !new.borrowable)
        && new.base_rate_bps == old.base_rate_bps
        && new.slope1_bps == old.slope1_bps
        && new.optimal_util_bps == old.optimal_util_bps
        && new.slope2_bps == old.slope2_bps
}

// ------------------------------------------------------------------ storage

fn bump_p(env: &Env, k: &DataKey) {
    gov::bump_persistent(env, k);
}

fn pool_cfg(env: &Env) -> PoolConfig {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error!(env, LendError::InvalidConfig))
}

fn reserves(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Reserves)
        .unwrap_or_else(|| Vec::new(env))
}

fn res_cfg(env: &Env, a: &Address) -> ReserveConfig {
    let k = DataKey::ResCfg(a.clone());
    let v = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(env, LendError::ReserveNotFound));
    bump_p(env, &k);
    v
}

fn raw_state(env: &Env, a: &Address) -> ReserveState {
    let k = DataKey::ResState(a.clone());
    let v = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(env, LendError::ReserveNotFound));
    bump_p(env, &k);
    v
}

fn put_state(env: &Env, a: &Address, s: &ReserveState) {
    let k = DataKey::ResState(a.clone());
    env.storage().persistent().set(&k, s);
    bump_p(env, &k);
}

/// Load a reserve with interest accrued to now (and persist the accrual).
fn load(env: &Env, a: &Address) -> (ReserveConfig, ReserveState) {
    let c = res_cfg(env, a);
    let mut s = raw_state(env, a);
    let now = env.ledger().timestamp();
    if now > s.last_update {
        accrue(env, &c, &mut s, now);
        put_state(env, a, &s);
    }
    (c, s)
}

/// Reserve with interest accrued to now, without writing (views).
fn load_view(env: &Env, a: &Address) -> (ReserveConfig, ReserveState) {
    let c = res_cfg(env, a);
    let mut s = raw_state(env, a);
    accrue(env, &c, &mut s, env.ledger().timestamp());
    (c, s)
}

fn get_pos(env: &Env, u: &Address, a: &Address) -> UserPosition {
    let k = DataKey::Pos(u.clone(), a.clone());
    let v = env.storage().persistent().get(&k).unwrap_or(UserPosition {
        scaled_supply: 0,
        scaled_debt: 0,
        collateral: false,
    });
    bump_p(env, &k);
    v
}

fn user_assets(env: &Env, u: &Address) -> Vec<Address> {
    let k = DataKey::UserAssets(u.clone());
    let v = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| Vec::new(env));
    bump_p(env, &k);
    v
}

/// Persist a position, maintaining the bounded per-user reserve list.
fn put_pos(env: &Env, u: &Address, a: &Address, p: &UserPosition) {
    let k = DataKey::Pos(u.clone(), a.clone());
    let lk = DataKey::UserAssets(u.clone());
    let mut list = user_assets(env, u);
    let idx = list.first_index_of(a);
    if p.scaled_supply == 0 && p.scaled_debt == 0 {
        env.storage().persistent().remove(&k);
        if let Some(i) = idx {
            list.remove(i);
        }
    } else {
        env.storage().persistent().set(&k, p);
        bump_p(env, &k);
        if idx.is_none() {
            if list.len() >= pool_cfg(env).max_user_reserves {
                panic_with_error!(env, LendError::TooManyUserReserves);
            }
            list.push_back(a.clone());
        }
    }
    if list.is_empty() {
        env.storage().persistent().remove(&lk);
    } else {
        env.storage().persistent().set(&lk, &list);
        bump_p(env, &lk);
    }
}

fn borrower_count(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::BorrowerCount).unwrap_or(0)
}

fn borrower_insert(env: &Env, u: &Address) {
    let st = env.storage().persistent();
    if st.has(&DataKey::BorrowerSlot(u.clone())) {
        return;
    }
    let n = borrower_count(env);
    if n >= pool_cfg(env).max_borrowers {
        panic_with_error!(env, LendError::TooManyBorrowers);
    }
    st.set(&DataKey::BorrowerAt(n), u);
    st.set(&DataKey::BorrowerSlot(u.clone()), &n);
    bump_p(env, &DataKey::BorrowerAt(n));
    bump_p(env, &DataKey::BorrowerSlot(u.clone()));
    let next = n
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(env, LendError::TooManyBorrowers));
    env.storage().instance().set(&DataKey::BorrowerCount, &next);
}

fn borrower_remove(env: &Env, u: &Address) {
    let st = env.storage().persistent();
    let slot: u32 = match st.get(&DataKey::BorrowerSlot(u.clone())) {
        Some(s) => s,
        None => return,
    };
    let last = borrower_count(env).saturating_sub(1);
    if slot != last {
        let moved: Address = st
            .get(&DataKey::BorrowerAt(last))
            .unwrap_or_else(|| panic_with_error!(env, LendError::NoDebt));
        st.set(&DataKey::BorrowerAt(slot), &moved);
        st.set(&DataKey::BorrowerSlot(moved.clone()), &slot);
        bump_p(env, &DataKey::BorrowerAt(slot));
        bump_p(env, &DataKey::BorrowerSlot(moved));
    }
    st.remove(&DataKey::BorrowerAt(last));
    st.remove(&DataKey::BorrowerSlot(u.clone()));
    env.storage().instance().set(&DataKey::BorrowerCount, &last);
}

/// Keep the borrower index in sync after `u`'s debt changed.
fn sync_borrower(env: &Env, u: &Address) {
    let mut has_debt = false;
    for a in user_assets(env, u).iter() {
        if get_pos(env, u, &a).scaled_debt > 0 {
            has_debt = true;
            break;
        }
    }
    if has_debt {
        borrower_insert(env, u);
    } else {
        borrower_remove(env, u);
    }
}

// ------------------------------------------------------------------ oracle

fn oracle_addr(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Oracle)
        .unwrap_or_else(|| panic_with_error!(env, LendError::NoPrice))
}

/// Validate an oracle record (lesson F-07): positive, not future-dated
/// beyond `MAX_FUTURE_SKEW`, not older than `max_age`.
pub fn check_price(env: &Env, pd: &PriceData, max_age: u64) -> i128 {
    let now = env.ledger().timestamp();
    if pd.price <= 0 {
        panic_with_error!(env, LendError::NoPrice);
    }
    if pd.timestamp > gov::checked_add_u64(env, now, MAX_FUTURE_SKEW) {
        panic_with_error!(env, LendError::FuturePrice);
    }
    if now.saturating_sub(pd.timestamp) > max_age {
        panic_with_error!(env, LendError::StalePrice);
    }
    pd.price
}

fn price_of(env: &Env, a: &Address) -> i128 {
    let pd = OracleClient::new(env, &oracle_addr(env))
        .lastprice(&Asset::Stellar(a.clone()))
        .unwrap_or_else(|| panic_with_error!(env, LendError::NoPrice));
    check_price(env, &pd, pool_cfg(env).max_price_age)
}

// ------------------------------------------------------------------ accounts

/// Account totals using current (accrued, not persisted) indices and live prices.
pub fn account_data(env: &Env, u: &Address) -> AccountData {
    let mut col = 0i128;
    let mut lim = 0i128;
    let mut thr = 0i128;
    let mut debt = 0i128;
    for a in user_assets(env, u).iter() {
        let p = get_pos(env, u, &a);
        let counts_col = p.collateral && p.scaled_supply > 0;
        if !counts_col && p.scaled_debt == 0 {
            continue;
        }
        let (c, s) = load_view(env, &a);
        let price = price_of(env, &a);
        if counts_col {
            let bal = supply_balance(env, p.scaled_supply, s.supply_index);
            let v = usd_value(env, bal, price, c.decimals, false);
            col = gov::add(env, col, v);
            if c.collateral_enabled {
                lim = gov::add(env, lim, gov::mul_div_floor(env, v, i128::from(c.ltv_bps), BPS));
            }
            thr = gov::add(env, thr, gov::mul_div_floor(env, v, i128::from(c.liq_threshold_bps), BPS));
        }
        if p.scaled_debt > 0 {
            let d = debt_balance(env, p.scaled_debt, s.borrow_index);
            debt = gov::add(env, debt, usd_value(env, d, price, c.decimals, true));
        }
    }
    AccountData {
        collateral_usd: col,
        borrow_limit_usd: lim,
        liq_threshold_usd: thr,
        debt_usd: debt,
        health_factor: health_factor(env, thr, debt),
    }
}

fn has_debt(env: &Env, u: &Address) -> bool {
    for a in user_assets(env, u).iter() {
        if get_pos(env, u, &a).scaled_debt > 0 {
            return true;
        }
    }
    false
}

/// Panic unless `u` is healthy (HF ≥ 1); skipped when `u` has no debt.
fn require_healthy(env: &Env, u: &Address) {
    if !has_debt(env, u) {
        return;
    }
    if account_data(env, u).health_factor < HF_ONE {
        panic_with_error!(env, LendError::HealthFactorTooLow);
    }
}

fn pos_amount(amount: i128, env: &Env) {
    if amount <= 0 {
        panic_with_error!(env, LendError::ZeroAmount);
    }
}

fn transfer_in(env: &Env, asset: &Address, from: &Address, amount: i128) {
    token::Client::new(env, asset).transfer(from, env.current_contract_address(), &amount);
}

fn transfer_out(env: &Env, asset: &Address, to: &Address, amount: i128) {
    token::Client::new(env, asset).transfer(&env.current_contract_address(), to, &amount);
}

/// Write off all remaining debt of `u` if they have no supply left.
/// Returns true if bad debt was recorded.
fn settle_bad_debt(env: &Env, u: &Address) -> bool {
    let list = user_assets(env, u);
    let mut any_debt = false;
    for a in list.iter() {
        let p = get_pos(env, u, &a);
        if p.scaled_supply > 0 {
            return false;
        }
        if p.scaled_debt > 0 {
            any_debt = true;
        }
    }
    if !any_debt {
        return false;
    }
    for a in list.iter() {
        let mut p = get_pos(env, u, &a);
        if p.scaled_debt == 0 {
            continue;
        }
        let (_c, mut s) = load(env, &a);
        let amount = debt_balance(env, p.scaled_debt, s.borrow_index);
        s.scaled_debt = gov::sub(env, s.scaled_debt, p.scaled_debt);
        let cover = if s.treasury < amount { s.treasury } else { amount };
        s.treasury = gov::sub(env, s.treasury, cover);
        s.bad_debt = gov::add(env, s.bad_debt, gov::sub(env, amount, cover));
        put_state(env, &a, &s);
        p.scaled_debt = 0;
        put_pos(env, u, &a, &p);
        BadDebt {
            borrower: u.clone(),
            asset: a.clone(),
            amount,
            covered_by_treasury: cover,
        }
        .publish(env);
    }
    borrower_remove(env, u);
    true
}

// ------------------------------------------------------------------ contract

#[contract]
pub struct LendingPool;

quasaria_gov::governance_entrypoints!(LendingPool, LendingAction);
quasaria_gov::pause_entrypoints!(LendingPool);

#[contractimpl]
impl LendingPool {
    /// `timelock_delay`: ≥ 60 s on testnet, ≥ 48 h enforced on mainnet.
    pub fn __constructor(env: Env, admin: Address, oracle: Address, config: PoolConfig, timelock_delay: u64) {
        validate_pool_config(&env, &config);
        gov::init(&env, &admin, timelock_delay);
        let dec = OracleClient::new(&env, &oracle).decimals();
        let st = env.storage().instance();
        st.set(&DataKey::Oracle, &oracle);
        st.set(&DataKey::OracleDecimals, &dec);
        st.set(&DataKey::Config, &config);
        st.set(&DataKey::Reserves, &Vec::<Address>::new(&env));
        st.set(&DataKey::BorrowerCount, &0u32);
    }

    // ------------------------------------------------ admin

    /// Apply a queued timelocked action after its delay has elapsed.
    pub fn execute_action(env: Env, action: LendingAction) {
        gov::consume(&env, &action);
        match action {
            LendingAction::SetOracle(oracle) => {
                let dec = OracleClient::new(&env, &oracle).decimals();
                env.storage().instance().set(&DataKey::Oracle, &oracle);
                env.storage().instance().set(&DataKey::OracleDecimals, &dec);
                OracleSet { oracle }.publish(&env);
            }
            LendingAction::SetPoolConfig(config) => {
                validate_pool_config(&env, &config);
                env.storage().instance().set(&DataKey::Config, &config);
                PoolConfigSet { config }.publish(&env);
            }
            LendingAction::SetReserveConfig(asset, config) => {
                validate_reserve_config(&env, &config);
                let (_old, s) = load(&env, &asset);
                put_state(&env, &asset, &s);
                Self::write_cfg(&env, &asset, &config);
            }
            LendingAction::WithdrawTreasury(asset, to, amount) => {
                let (_c, mut s) = load(&env, &asset);
                if amount <= 0 || amount > s.treasury || amount > s.cash {
                    panic_with_error!(&env, LendError::InsufficientLiquidity);
                }
                s.treasury = gov::sub(&env, s.treasury, amount);
                s.cash = gov::sub(&env, s.cash, amount);
                put_state(&env, &asset, &s);
                transfer_out(&env, &asset, &to, amount);
                TreasuryWithdrawn { asset, to, amount }.publish(&env);
            }
            LendingAction::Upgrade(hash) => gov::upgrade_now(&env, &hash),
            LendingAction::SetDelay(d) => gov::set_delay_now(&env, d),
        }
    }

    fn write_cfg(env: &Env, asset: &Address, config: &ReserveConfig) {
        let k = DataKey::ResCfg(asset.clone());
        env.storage().persistent().set(&k, config);
        bump_p(env, &k);
        ReserveSet {
            asset: asset.clone(),
            config: config.clone(),
        }
        .publish(env);
    }

    /// List a new reserve (admin). On mainnet a new listing can't be
    /// collateral: enabling collateral later goes through the timelock.
    pub fn add_reserve(env: Env, asset: Address, config: ReserveConfig) {
        gov::require_admin(&env);
        validate_reserve_config(&env, &config);
        if gov::is_mainnet(&env) && config.collateral_enabled {
            panic_with_error!(&env, LendError::MainnetListing);
        }
        let k = DataKey::ResCfg(asset.clone());
        if env.storage().persistent().has(&k) {
            panic_with_error!(&env, LendError::ReserveExists);
        }
        let mut list = reserves(&env);
        if list.len() >= MAX_RESERVES {
            panic_with_error!(&env, LendError::TooManyReserves);
        }
        list.push_back(asset.clone());
        env.storage().instance().set(&DataKey::Reserves, &list);
        put_state(
            &env,
            &asset,
            &ReserveState {
                supply_index: SCALE,
                borrow_index: SCALE,
                scaled_supply: 0,
                scaled_debt: 0,
                cash: 0,
                treasury: 0,
                bad_debt: 0,
                last_update: env.ledger().timestamp(),
            },
        );
        Self::write_cfg(&env, &asset, &config);
    }

    /// Immediately apply a strictly risk-reducing reserve change (lower LTV
    /// or caps, disable borrowing or new collateral). Anything else must go
    /// through `propose_action(SetReserveConfig)`.
    pub fn tighten_reserve(env: Env, asset: Address, config: ReserveConfig) {
        gov::require_admin(&env);
        validate_reserve_config(&env, &config);
        let old = res_cfg(&env, &asset);
        if !is_risk_reducing(&old, &config) {
            panic_with_error!(&env, LendError::NotRiskReducing);
        }
        let (_c, s) = load(&env, &asset);
        put_state(&env, &asset, &s);
        Self::write_cfg(&env, &asset, &config);
    }

    // ------------------------------------------------ user

    /// Supply `amount` of `asset`. The first supply of a collateral-enabled
    /// asset is used as collateral automatically (toggle with `set_collateral`).
    pub fn supply(env: Env, user: Address, asset: Address, amount: i128) {
        user.require_auth();
        gov::when_not_paused(&env);
        gov::bump_instance(&env);
        pos_amount(amount, &env);
        let (c, mut s) = load(&env, &asset);
        let mut p = get_pos(&env, &user, &asset);
        let minted = gov::mul_div_floor(&env, amount, SCALE, s.supply_index);
        if minted <= 0 {
            panic_with_error!(&env, LendError::BelowMinSupply);
        }
        let first = p.scaled_supply == 0;
        p.scaled_supply = gov::add(&env, p.scaled_supply, minted);
        if supply_balance(&env, p.scaled_supply, s.supply_index) < c.min_supply {
            panic_with_error!(&env, LendError::BelowMinSupply);
        }
        s.scaled_supply = gov::add(&env, s.scaled_supply, minted);
        s.cash = gov::add(&env, s.cash, amount);
        if supply_balance(&env, s.scaled_supply, s.supply_index) > c.supply_cap {
            panic_with_error!(&env, LendError::SupplyCapExceeded);
        }
        if first && c.collateral_enabled && !p.collateral {
            p.collateral = true;
        }
        transfer_in(&env, &asset, &user, amount);
        put_state(&env, &asset, &s);
        put_pos(&env, &user, &asset, &p);
        Supplied { user, asset, amount }.publish(&env);
    }

    /// Withdraw `amount` (`i128::MAX` = everything). Allowed while paused as
    /// long as the account stays healthy. Returns the amount sent.
    pub fn withdraw(env: Env, user: Address, asset: Address, amount: i128) -> i128 {
        user.require_auth();
        gov::bump_instance(&env);
        pos_amount(amount, &env);
        let (c, mut s) = load(&env, &asset);
        let mut p = get_pos(&env, &user, &asset);
        let bal = supply_balance(&env, p.scaled_supply, s.supply_index);
        let (out, burned) = if amount >= bal {
            (bal, p.scaled_supply)
        } else {
            (amount, gov::mul_div_ceil(&env, amount, SCALE, s.supply_index))
        };
        if out <= 0 || burned > p.scaled_supply {
            panic_with_error!(&env, LendError::InsufficientBalance);
        }
        p.scaled_supply = gov::sub(&env, p.scaled_supply, burned);
        let left = supply_balance(&env, p.scaled_supply, s.supply_index);
        if p.scaled_supply > 0 && left < c.min_supply {
            panic_with_error!(&env, LendError::DustRemaining);
        }
        if out > s.cash {
            panic_with_error!(&env, LendError::InsufficientLiquidity);
        }
        s.scaled_supply = gov::sub(&env, s.scaled_supply, burned);
        s.cash = gov::sub(&env, s.cash, out);
        if p.scaled_supply == 0 {
            p.collateral = false;
        }
        put_state(&env, &asset, &s);
        put_pos(&env, &user, &asset, &p);
        require_healthy(&env, &user);
        transfer_out(&env, &asset, &user, out);
        Withdrawn { user, asset, amount: out }.publish(&env);
        out
    }

    /// Borrow `amount`; the LTV-weighted borrow limit must cover all debt.
    pub fn borrow(env: Env, user: Address, asset: Address, amount: i128) {
        user.require_auth();
        gov::when_not_paused(&env);
        gov::bump_instance(&env);
        pos_amount(amount, &env);
        let (c, mut s) = load(&env, &asset);
        if !c.borrowable {
            panic_with_error!(&env, LendError::NotBorrowable);
        }
        if amount < c.min_borrow {
            panic_with_error!(&env, LendError::BelowMinBorrow);
        }
        if amount > s.cash {
            panic_with_error!(&env, LendError::InsufficientLiquidity);
        }
        let mut p = get_pos(&env, &user, &asset);
        let minted = gov::mul_div_ceil(&env, amount, SCALE, s.borrow_index);
        p.scaled_debt = gov::add(&env, p.scaled_debt, minted);
        s.scaled_debt = gov::add(&env, s.scaled_debt, minted);
        s.cash = gov::sub(&env, s.cash, amount);
        if debt_balance(&env, s.scaled_debt, s.borrow_index) > c.borrow_cap {
            panic_with_error!(&env, LendError::BorrowCapExceeded);
        }
        put_state(&env, &asset, &s);
        put_pos(&env, &user, &asset, &p);
        let acct = account_data(&env, &user);
        if acct.debt_usd > acct.borrow_limit_usd {
            panic_with_error!(&env, LendError::InsufficientCollateral);
        }
        if acct.health_factor < HF_ONE {
            panic_with_error!(&env, LendError::HealthFactorTooLow);
        }
        borrower_insert(&env, &user);
        transfer_out(&env, &asset, &user, amount);
        Borrowed { user, asset, amount }.publish(&env);
    }

    /// Repay `user`'s debt from `payer` (anyone may repay for anyone).
    /// `amount = i128::MAX` repays everything. Never paused. Returns the
    /// amount taken from `payer`.
    pub fn repay(env: Env, payer: Address, user: Address, asset: Address, amount: i128) -> i128 {
        payer.require_auth();
        gov::bump_instance(&env);
        pos_amount(amount, &env);
        let (c, mut s) = load(&env, &asset);
        let mut p = get_pos(&env, &user, &asset);
        if p.scaled_debt == 0 {
            panic_with_error!(&env, LendError::NoDebt);
        }
        let debt = debt_balance(&env, p.scaled_debt, s.borrow_index);
        let (paid, burned) = if amount >= debt {
            (debt, p.scaled_debt)
        } else {
            let b = gov::mul_div_floor(&env, amount, SCALE, s.borrow_index);
            (amount, b)
        };
        p.scaled_debt = gov::sub(&env, p.scaled_debt, burned);
        if p.scaled_debt > 0 && debt_balance(&env, p.scaled_debt, s.borrow_index) < c.min_borrow {
            panic_with_error!(&env, LendError::DustRemaining);
        }
        s.scaled_debt = gov::sub(&env, s.scaled_debt, burned);
        s.cash = gov::add(&env, s.cash, paid);
        transfer_in(&env, &asset, &payer, paid);
        put_state(&env, &asset, &s);
        put_pos(&env, &user, &asset, &p);
        sync_borrower(&env, &user);
        Repaid {
            user,
            asset,
            payer,
            amount: paid,
        }
        .publish(&env);
        paid
    }

    /// Use (or stop using) a supplied asset as collateral. Disabling is
    /// blocked if it would drop HF below 1.
    pub fn set_collateral(env: Env, user: Address, asset: Address, enabled: bool) {
        user.require_auth();
        gov::bump_instance(&env);
        let c = res_cfg(&env, &asset);
        let mut p = get_pos(&env, &user, &asset);
        if enabled {
            if !c.collateral_enabled {
                panic_with_error!(&env, LendError::NotCollateral);
            }
            if p.scaled_supply == 0 {
                panic_with_error!(&env, LendError::InsufficientBalance);
            }
        }
        if p.collateral == enabled {
            return;
        }
        p.collateral = enabled;
        put_pos(&env, &user, &asset, &p);
        if !enabled {
            require_healthy(&env, &user);
        }
        CollateralSet { user, asset, enabled }.publish(&env);
    }

    /// Liquidate an unhealthy account (HF < 1): repay up to the close factor
    /// of `debt_asset` and seize `collateral_asset` worth `repay × (1 +
    /// bonus)`. With `receive_shares` the liquidator gets supply shares
    /// instead of tokens (works even when the reserve has no cash). Never
    /// paused. Returns (repaid, seized).
    pub fn liquidate(
        env: Env,
        liquidator: Address,
        borrower: Address,
        debt_asset: Address,
        collateral_asset: Address,
        repay_amount: i128,
        receive_shares: bool,
    ) -> (i128, i128) {
        liquidator.require_auth();
        gov::bump_instance(&env);
        pos_amount(repay_amount, &env);
        let acct = account_data(&env, &borrower);
        if acct.health_factor >= HF_ONE {
            panic_with_error!(&env, LendError::Healthy);
        }
        let cfg = pool_cfg(&env);
        let (dc, mut ds) = load(&env, &debt_asset);
        let mut dp = get_pos(&env, &borrower, &debt_asset);
        if dp.scaled_debt == 0 {
            panic_with_error!(&env, LendError::NoDebt);
        }
        let mut cp = get_pos(&env, &borrower, &collateral_asset);
        if !cp.collateral || cp.scaled_supply == 0 {
            panic_with_error!(&env, LendError::NothingToSeize);
        }
        let (cc, mut cs) = load(&env, &collateral_asset);
        let p_debt = price_of(&env, &debt_asset);
        let p_col = price_of(&env, &collateral_asset);

        // close factor; the whole debt only when it's dust
        let debt = debt_balance(&env, dp.scaled_debt, ds.borrow_index);
        let debt_usd = usd_value(&env, debt, p_debt, dc.decimals, true);
        let half = gov::mul_div_floor(&env, debt, i128::from(cfg.close_factor_bps), BPS);
        let max_close = if debt_usd <= cfg.close_dust_usd || gov::sub(&env, debt, half) < dc.min_borrow {
            debt
        } else {
            half
        };
        let mut repay = if repay_amount < max_close { repay_amount } else { max_close };
        let bonus = gov::add(&env, BPS, i128::from(cc.liq_bonus_bps));
        let repay_usd = usd_value(&env, repay, p_debt, dc.decimals, false);
        let seize_usd = gov::mul_div_floor(&env, repay_usd, bonus, BPS);
        let dec_c = pow10(&env, cc.decimals);
        let mut seize = gov::mul_div_floor(&env, seize_usd, dec_c, p_col);
        let col_bal = supply_balance(&env, cp.scaled_supply, cs.supply_index);
        let burned;
        if seize >= col_bal {
            // not enough collateral: take all of it, repay proportionally less
            seize = col_bal;
            burned = cp.scaled_supply;
            let col_usd = usd_value(&env, seize, p_col, cc.decimals, false);
            let need_usd = gov::mul_div_ceil(&env, col_usd, BPS, bonus);
            let need = gov::mul_div_ceil(&env, need_usd, pow10(&env, dc.decimals), p_debt);
            if need < repay {
                repay = need;
            }
        } else {
            burned = gov::mul_div_ceil(&env, seize, SCALE, cs.supply_index);
        }
        if repay <= 0 || seize <= 0 {
            panic_with_error!(&env, LendError::NothingToSeize);
        }
        // debt side
        let debt_burn = if repay >= debt {
            dp.scaled_debt
        } else {
            gov::mul_div_floor(&env, repay, SCALE, ds.borrow_index)
        };
        dp.scaled_debt = gov::sub(&env, dp.scaled_debt, debt_burn);
        ds.scaled_debt = gov::sub(&env, ds.scaled_debt, debt_burn);
        ds.cash = gov::add(&env, ds.cash, repay);
        transfer_in(&env, &debt_asset, &liquidator, repay);
        put_state(&env, &debt_asset, &ds);
        put_pos(&env, &borrower, &debt_asset, &dp);
        // collateral side (reload state: debt and collateral may be the same reserve)
        if debt_asset == collateral_asset {
            cs = ds.clone();
            cp = get_pos(&env, &borrower, &collateral_asset);
        }
        cp.scaled_supply = gov::sub(&env, cp.scaled_supply, burned);
        if cp.scaled_supply == 0 {
            cp.collateral = false;
        }
        if receive_shares {
            let credited = gov::mul_div_floor(&env, seize, SCALE, cs.supply_index);
            // the rounding remainder stays in the pool
            cs.scaled_supply = gov::sub(&env, cs.scaled_supply, gov::sub(&env, burned, credited));
            put_pos(&env, &borrower, &collateral_asset, &cp);
            let mut lp = get_pos(&env, &liquidator, &collateral_asset);
            lp.scaled_supply = gov::add(&env, lp.scaled_supply, credited);
            put_state(&env, &collateral_asset, &cs);
            put_pos(&env, &liquidator, &collateral_asset, &lp);
        } else {
            if seize > cs.cash {
                panic_with_error!(&env, LendError::InsufficientLiquidity);
            }
            cs.scaled_supply = gov::sub(&env, cs.scaled_supply, burned);
            cs.cash = gov::sub(&env, cs.cash, seize);
            put_state(&env, &collateral_asset, &cs);
            put_pos(&env, &borrower, &collateral_asset, &cp);
            transfer_out(&env, &collateral_asset, &liquidator, seize);
        }
        Liquidated {
            borrower: borrower.clone(),
            liquidator,
            debt_asset,
            collateral_asset,
            repaid: repay,
            seized: seize,
        }
        .publish(&env);
        if !settle_bad_debt(&env, &borrower) {
            sync_borrower(&env, &borrower);
        }
        (repay, seize)
    }

    /// Anyone: write off the debt of an account that has no supply left.
    pub fn resolve_bad_debt(env: Env, borrower: Address) {
        gov::bump_instance(&env);
        if !settle_bad_debt(&env, &borrower) {
            panic_with_error!(&env, LendError::NotBadDebt);
        }
    }

    /// Anyone: donate tokens to cover recorded bad debt of a reserve.
    pub fn cover_bad_debt(env: Env, from: Address, asset: Address, amount: i128) -> i128 {
        from.require_auth();
        pos_amount(amount, &env);
        let (_c, mut s) = load(&env, &asset);
        let take = if amount < s.bad_debt { amount } else { s.bad_debt };
        if take <= 0 {
            panic_with_error!(&env, LendError::NotBadDebt);
        }
        s.bad_debt = gov::sub(&env, s.bad_debt, take);
        s.cash = gov::add(&env, s.cash, take);
        transfer_in(&env, &asset, &from, take);
        put_state(&env, &asset, &s);
        BadDebtCovered { asset, from, amount: take }.publish(&env);
        take
    }

    /// Anyone: persist interest accrual for a reserve.
    pub fn accrue_interest(env: Env, asset: Address) {
        gov::bump_instance(&env);
        load(&env, &asset);
    }

    // ------------------------------------------------ views

    pub fn pool_config(env: Env) -> PoolConfig {
        pool_cfg(&env)
    }

    pub fn oracle(env: Env) -> Address {
        oracle_addr(&env)
    }

    pub fn oracle_decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::OracleDecimals).unwrap_or(14)
    }

    pub fn reserve_list(env: Env) -> Vec<Address> {
        reserves(&env)
    }

    pub fn reserve_config(env: Env, asset: Address) -> ReserveConfig {
        res_cfg(&env, &asset)
    }

    /// Reserve summary with interest accrued to now.
    pub fn reserve(env: Env, asset: Address) -> ReserveView {
        let (c, s) = load_view(&env, &asset);
        let total_debt = debt_balance(&env, s.scaled_debt, s.borrow_index);
        let u = utilization_bps(&env, s.cash, total_debt);
        ReserveView {
            asset,
            total_supply: supply_balance(&env, s.scaled_supply, s.supply_index),
            total_debt,
            utilization_bps: u,
            borrow_rate_bps: borrow_rate_bps(&env, &c, u),
            supply_rate_bps: supply_rate_bps(&env, &c, u),
            config: c,
            state: s,
        }
    }

    /// Up to `limit` (≤ MAX_PAGE) reserve summaries starting at `start`.
    pub fn reserves_page(env: Env, start: u32, limit: u32) -> Vec<ReserveView> {
        let list = reserves(&env);
        let lim = if limit > MAX_PAGE { MAX_PAGE } else { limit };
        let end = start.saturating_add(lim).min(list.len());
        let mut out = Vec::new(&env);
        let mut i = start;
        while i < end {
            if let Some(a) = list.get(i) {
                out.push_back(Self::reserve(env.clone(), a));
            }
            i = i.saturating_add(1);
        }
        out
    }

    pub fn user_assets(env: Env, user: Address) -> Vec<Address> {
        user_assets(&env, &user)
    }

    pub fn user_reserve(env: Env, user: Address, asset: Address) -> UserReserveView {
        let (_c, s) = load_view(&env, &asset);
        let p = get_pos(&env, &user, &asset);
        UserReserveView {
            asset,
            supplied: supply_balance(&env, p.scaled_supply, s.supply_index),
            borrowed: debt_balance(&env, p.scaled_debt, s.borrow_index),
            collateral: p.collateral,
        }
    }

    /// All of a user's positions (bounded by `max_user_reserves`).
    pub fn user_positions(env: Env, user: Address) -> Vec<UserReserveView> {
        let mut out = Vec::new(&env);
        for a in user_assets(&env, &user).iter() {
            out.push_back(Self::user_reserve(env.clone(), user.clone(), a));
        }
        out
    }

    pub fn account(env: Env, user: Address) -> AccountData {
        account_data(&env, &user)
    }

    pub fn borrower_count(env: Env) -> u32 {
        borrower_count(&env)
    }

    /// Paged borrower index for keepers (≤ MAX_PAGE per call).
    pub fn borrowers_page(env: Env, start: u32, limit: u32) -> Vec<Address> {
        let n = borrower_count(&env);
        let lim = if limit > MAX_PAGE { MAX_PAGE } else { limit };
        let end = start.saturating_add(lim).min(n);
        let mut out = Vec::new(&env);
        let mut i = start;
        while i < end {
            if let Some(a) = env.storage().persistent().get(&DataKey::BorrowerAt(i)) {
                out.push_back(a);
            }
            i = i.saturating_add(1);
        }
        out
    }
}

#[cfg(test)]
mod test;
