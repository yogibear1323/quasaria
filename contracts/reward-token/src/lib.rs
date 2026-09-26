//! # Quasaria Flux (QFX) — holder-reward token
//!
//! A SEP-41 compatible Soroban token whose holders earn **daily compounded
//! interest just by holding**.
//!
//! ## Index / share accounting
//! Balances are stored as *shares*. A single global `index` (18-decimal fixed
//! point, starts at 1.0) converts shares to tokens:
//!
//! ```text
//! balance(user) = shares(user) * index / 1e18
//! ```
//!
//! Once per elapsed UTC day (counted from `genesis`), the index is multiplied
//! by `(1 + apr / 365)`. Because every holder's balance is derived from the
//! same index, everyone compounds in O(1) with no per-holder loops.
//!
//! ## Rate governance
//! The admin sets a nominal APR in basis points, compounded daily. It is
//! hard-capped at [`MAX_APR_BPS`] (25% APR ≈ 28.4% APY). `current_apy_bps`
//! reports the effective compounded APY.
//!
//! ## Funding / emission model
//! Interest is **minted** (inflationary emission). Emission is bounded by an
//! immutable-upwards `max_supply`: if compounding would push total supply
//! above the cap, the index is clamped so supply lands exactly on the cap and
//! rewards stop until the admin lowers supply (burns) or the cap is raised
//! (it can only be *lowered* after deployment; see `set_max_supply`).
//! Rounding always favours the protocol (floor on credit, ceil on debit).
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, MuxedAddress, String,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria Flux (QFX) holder-reward token");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

pub const SCALE: i128 = 1_000_000_000_000_000_000; // 1e18
pub const DAY_SECONDS: u64 = 86_400;
/// Hard cap on the admin-configurable nominal APR (basis points).
pub const MAX_APR_BPS: u32 = 2_500;
const BPS: i128 = 10_000;

const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP_THRESHOLD: u32 = 7 * DAY_LEDGERS;
const INSTANCE_BUMP_TO: u32 = 30 * DAY_LEDGERS;
const BAL_BUMP_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const BAL_BUMP_TO: u32 = 120 * DAY_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    NegativeAmount = 1,
    InsufficientBalance = 2,
    InsufficientAllowance = 3,
    AprTooHigh = 4,
    MaxSupplyExceeded = 5,
    InvalidExpiration = 6,
    InvalidMaxSupply = 7,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Name,
    Symbol,
    Decimals,
    Index,
    LastDay,
    Genesis,
    AprBps,
    MaxSupply,
    TotalShares,
    Shares(Address),
    Allowance(Address, Address),
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub live_until_ledger: u32,
}

/// Snapshot of the reward configuration for UIs / bots.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardInfo {
    pub index: i128,
    pub apr_bps: u32,
    pub apy_bps: u32,
    pub max_apr_bps: u32,
    pub total_supply: i128,
    pub max_supply: i128,
    pub total_shares: i128,
    pub genesis: u64,
    pub last_day: u64,
}

#[contractevent(topics = ["transfer"], data_format = "single-value")]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["mint"], data_format = "single-value")]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["burn"], data_format = "single-value")]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["approve"])]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contractevent(topics = ["rate_set"], data_format = "single-value")]
pub struct RateSet {
    pub apr_bps: u32,
}

#[contractevent(topics = ["index"])]
pub struct IndexUpdated {
    pub day: u64,
    pub index: i128,
}

// ---------------------------------------------------------------- math

/// floor(a * b / c) without intermediate overflow for our value ranges.
pub fn mul_div_floor(a: i128, b: i128, c: i128) -> i128 {
    match a.checked_mul(b) {
        Some(p) => p / c,
        None => (a / c) * b + (a % c) * b / c,
    }
}

/// ceil(a * b / c) for non-negative inputs.
pub fn mul_div_ceil(a: i128, b: i128, c: i128) -> i128 {
    let f = mul_div_floor(a, b, c);
    let exact = match a.checked_mul(b) {
        Some(p) => p % c == 0,
        None => ((a % c) * b) % c == 0,
    };
    if exact {
        f
    } else {
        f + 1
    }
}

/// (base / SCALE) ^ exp in SCALE fixed point, exponentiation by squaring.
pub fn pow_fixed(base: i128, mut exp: u64) -> i128 {
    let mut result = SCALE;
    let mut b = base;
    while exp > 0 {
        if exp & 1 == 1 {
            result = mul_div_floor(result, b, SCALE);
        }
        exp >>= 1;
        if exp > 0 {
            b = mul_div_floor(b, b, SCALE);
        }
    }
    result
}

/// Daily growth factor (SCALE fixed point) for a nominal APR.
pub fn daily_factor(apr_bps: u32) -> i128 {
    SCALE + (apr_bps as i128) * SCALE / (BPS * 365)
}

// ---------------------------------------------------------------- storage helpers

fn get_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0)
}

fn shares_of(env: &Env, id: &Address) -> i128 {
    let key = DataKey::Shares(id.clone());
    match env.storage().persistent().get::<DataKey, i128>(&key) {
        Some(v) => {
            env.storage()
                .persistent()
                .extend_ttl(&key, BAL_BUMP_THRESHOLD, BAL_BUMP_TO);
            v
        }
        None => 0,
    }
}

fn set_shares(env: &Env, id: &Address, v: i128) {
    let key = DataKey::Shares(id.clone());
    env.storage().persistent().set(&key, &v);
    env.storage()
        .persistent()
        .extend_ttl(&key, BAL_BUMP_THRESHOLD, BAL_BUMP_TO);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_TO);
}

fn check_nonneg(env: &Env, amount: i128) {
    if amount < 0 {
        panic_with_error!(env, TokenError::NegativeAmount);
    }
}

/// Compute (index, current_day) including all pending days, without writing.
fn projected_index(env: &Env) -> (i128, u64) {
    let st = env.storage().instance();
    let index: i128 = st.get(&DataKey::Index).unwrap_or(SCALE);
    let last_day: u64 = st.get(&DataKey::LastDay).unwrap_or(0);
    let genesis: u64 = st.get(&DataKey::Genesis).unwrap_or(0);
    let now = env.ledger().timestamp();
    let today = now.saturating_sub(genesis) / DAY_SECONDS;
    if today <= last_day {
        return (index, last_day);
    }
    let apr: u32 = st.get(&DataKey::AprBps).unwrap_or(0);
    let days = today - last_day;
    let factor = pow_fixed(daily_factor(apr), days);
    let mut new_index = mul_div_floor(index, factor, SCALE);

    // Emission cap: clamp so that total supply never exceeds max_supply.
    let total_shares: i128 = st.get(&DataKey::TotalShares).unwrap_or(0);
    let max_supply: i128 = st.get(&DataKey::MaxSupply).unwrap_or(i128::MAX);
    if total_shares > 0 {
        let supply = mul_div_floor(total_shares, new_index, SCALE);
        if supply > max_supply {
            let capped = mul_div_floor(max_supply, SCALE, total_shares);
            new_index = if capped > index { capped } else { index };
        }
    }
    (new_index, today)
}

/// Persist the projected index. Must run before any share/token conversion.
fn accrue(env: &Env) -> i128 {
    let (index, day) = projected_index(env);
    let st = env.storage().instance();
    let last_day: u64 = st.get(&DataKey::LastDay).unwrap_or(0);
    if day != last_day {
        st.set(&DataKey::Index, &index);
        st.set(&DataKey::LastDay, &day);
        IndexUpdated { day, index }.publish(env);
    }
    index
}

fn move_tokens(env: &Env, from: &Address, to: &Address, amount: i128) {
    check_nonneg(env, amount);
    let index = accrue(env);
    let shares = mul_div_ceil(amount, SCALE, index);
    let from_shares = shares_of(env, from);
    if from_shares < shares {
        panic_with_error!(env, TokenError::InsufficientBalance);
    }
    set_shares(env, from, from_shares - shares);
    let to_shares = shares_of(env, to);
    set_shares(env, to, to_shares + shares);
}

fn burn_tokens(env: &Env, from: &Address, amount: i128) {
    check_nonneg(env, amount);
    let index = accrue(env);
    let shares = mul_div_ceil(amount, SCALE, index);
    let from_shares = shares_of(env, from);
    if from_shares < shares {
        panic_with_error!(env, TokenError::InsufficientBalance);
    }
    set_shares(env, from, from_shares - shares);
    let total = get_i128(env, &DataKey::TotalShares);
    env.storage()
        .instance()
        .set(&DataKey::TotalShares, &(total - shares));
}

fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(from.clone(), spender.clone());
    match env.storage().temporary().get::<DataKey, AllowanceValue>(&key) {
        Some(a) if a.live_until_ledger >= env.ledger().sequence() => a,
        _ => AllowanceValue {
            amount: 0,
            live_until_ledger: 0,
        },
    }
}

fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
    let a = read_allowance(env, from, spender);
    if a.amount < amount {
        panic_with_error!(env, TokenError::InsufficientAllowance);
    }
    if amount > 0 {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount: a.amount - amount,
                live_until_ledger: a.live_until_ledger,
            },
        );
    }
}

// ---------------------------------------------------------------- contract

#[contract]
pub struct QuasariaFlux;

#[contractimpl]
impl QuasariaFlux {
    /// Deploy-time initialisation. `max_supply` bounds all emission.
    pub fn __constructor(
        env: Env,
        admin: Address,
        decimals: u32,
        name: String,
        symbol: String,
        apr_bps: u32,
        max_supply: i128,
    ) {
        if apr_bps > MAX_APR_BPS {
            panic_with_error!(&env, TokenError::AprTooHigh);
        }
        if max_supply <= 0 {
            panic_with_error!(&env, TokenError::InvalidMaxSupply);
        }
        let st = env.storage().instance();
        st.set(&DataKey::Admin, &admin);
        st.set(&DataKey::Decimals, &decimals);
        st.set(&DataKey::Name, &name);
        st.set(&DataKey::Symbol, &symbol);
        st.set(&DataKey::Index, &SCALE);
        st.set(&DataKey::LastDay, &0u64);
        st.set(&DataKey::Genesis, &env.ledger().timestamp());
        st.set(&DataKey::AprBps, &apr_bps);
        st.set(&DataKey::MaxSupply, &max_supply);
        st.set(&DataKey::TotalShares, &0i128);
    }

    // ----- admin

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        Self::admin(env.clone()).require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
    }

    /// Mint principal (e.g. initial distribution / liquidity mining).
    pub fn mint(env: Env, to: Address, amount: i128) {
        Self::admin(env.clone()).require_auth();
        check_nonneg(&env, amount);
        let index = accrue(&env);
        let supply = Self::total_supply(env.clone());
        let max: i128 = get_i128(&env, &DataKey::MaxSupply);
        if supply + amount > max {
            panic_with_error!(&env, TokenError::MaxSupplyExceeded);
        }
        let shares = mul_div_floor(amount, SCALE, index);
        set_shares(&env, &to, shares_of(&env, &to) + shares);
        let total = get_i128(&env, &DataKey::TotalShares);
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total + shares));
        bump_instance(&env);
        Mint { to, amount }.publish(&env);
    }

    /// Set the nominal APR (bps, compounded daily). Accrues first so the old
    /// rate applies to all fully elapsed days.
    pub fn set_apr_bps(env: Env, apr_bps: u32) {
        Self::admin(env.clone()).require_auth();
        if apr_bps > MAX_APR_BPS {
            panic_with_error!(&env, TokenError::AprTooHigh);
        }
        accrue(&env);
        env.storage().instance().set(&DataKey::AprBps, &apr_bps);
        bump_instance(&env);
        RateSet { apr_bps }.publish(&env);
    }

    /// The emission cap can only be lowered (never inflated after launch),
    /// and never below the current supply.
    pub fn set_max_supply(env: Env, max_supply: i128) {
        Self::admin(env.clone()).require_auth();
        accrue(&env);
        let cur_max = get_i128(&env, &DataKey::MaxSupply);
        if max_supply > cur_max || max_supply < Self::total_supply(env.clone()) {
            panic_with_error!(&env, TokenError::InvalidMaxSupply);
        }
        env.storage().instance().set(&DataKey::MaxSupply, &max_supply);
    }

    /// Permissionless: persist the index (keepers may call daily).
    pub fn accrue(env: Env) -> i128 {
        bump_instance(&env);
        accrue(&env)
    }

    // ----- views

    pub fn total_supply(env: Env) -> i128 {
        let (index, _) = projected_index(&env);
        mul_div_floor(get_i128(&env, &DataKey::TotalShares), index, SCALE)
    }

    pub fn shares(env: Env, id: Address) -> i128 {
        shares_of(&env, &id)
    }

    pub fn index(env: Env) -> i128 {
        projected_index(&env).0
    }

    /// Effective APY in bps from daily compounding of the nominal APR.
    pub fn current_apy_bps(env: Env) -> u32 {
        let apr: u32 = env.storage().instance().get(&DataKey::AprBps).unwrap_or(0);
        let f = pow_fixed(daily_factor(apr), 365);
        ((f - SCALE) * BPS / SCALE) as u32
    }

    pub fn reward_info(env: Env) -> RewardInfo {
        let st = env.storage().instance();
        let (index, last_day) = projected_index(&env);
        RewardInfo {
            index,
            apr_bps: st.get(&DataKey::AprBps).unwrap_or(0),
            apy_bps: Self::current_apy_bps(env.clone()),
            max_apr_bps: MAX_APR_BPS,
            total_supply: Self::total_supply(env.clone()),
            max_supply: get_i128(&env, &DataKey::MaxSupply),
            total_shares: get_i128(&env, &DataKey::TotalShares),
            genesis: st.get(&DataKey::Genesis).unwrap_or(0),
            last_day,
        }
    }
}

#[contractimpl]
impl token::TokenInterface for QuasariaFlux {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        read_allowance(&env, &from, &spender).amount
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        from.require_auth();
        check_nonneg(&env, amount);
        if amount > 0 && live_until_ledger < env.ledger().sequence() {
            panic_with_error!(&env, TokenError::InvalidExpiration);
        }
        let key = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount,
                live_until_ledger,
            },
        );
        if amount > 0 {
            let live_for = live_until_ledger - env.ledger().sequence();
            env.storage().temporary().extend_ttl(&key, live_for, live_for);
        }
        bump_instance(&env);
        Approve {
            from,
            spender,
            amount,
            live_until_ledger,
        }
        .publish(&env);
    }

    fn balance(env: Env, id: Address) -> i128 {
        let (index, _) = projected_index(&env);
        mul_div_floor(shares_of(&env, &id), index, SCALE)
    }

    fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to = to.address();
        move_tokens(&env, &from, &to, amount);
        bump_instance(&env);
        Transfer { from, to, amount }.publish(&env);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        check_nonneg(&env, amount);
        spend_allowance(&env, &from, &spender, amount);
        move_tokens(&env, &from, &to, amount);
        bump_instance(&env);
        Transfer { from, to, amount }.publish(&env);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        burn_tokens(&env, &from, amount);
        bump_instance(&env);
        Burn { from, amount }.publish(&env);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        check_nonneg(&env, amount);
        spend_allowance(&env, &from, &spender, amount);
        burn_tokens(&env, &from, amount);
        bump_instance(&env);
        Burn { from, amount }.publish(&env);
    }

    fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap()
    }

    fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }
}

#[cfg(test)]
mod test;
