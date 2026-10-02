//! # Quasaria Flux (QFX) — fully backed 1:1 XLM wrapper with reserve-funded holder yield
//!
//! **1 QFX = 1 XLM, fully backed.** QFX can only come into existence when the
//! same amount of native XLM is moved into this contract through the native
//! XLM Stellar Asset Contract (SAC), and it is destroyed when XLM leaves:
//!
//! * [`QuasariaFlux::deposit`] pulls `amount` XLM from `from` and mints `amount` QFX.
//! * [`QuasariaFlux::redeem`] burns `amount` QFX and returns `amount` XLM.
//! * SEP-41 `burn` / `burn_from` behave like `redeem` (the XLM goes back to the
//!   owner), so burning can never strand collateral.
//! * There is **no admin mint**. The only other way supply grows is
//!   [`QuasariaFlux::fund_yield`], which also pulls the same amount of XLM
//!   first (the new QFX sits in the holder-yield reserve), and
//!   [`QuasariaFlux::sweep_surplus`], which only mints against XLM that was
//!   already donated to the contract.
//!
//! Invariant (checked on every deposit / redeem / fund): the contract's XLM
//! balance ≥ `total_supply`, and they are exactly equal unless someone sends
//! XLM to the contract outside `deposit` (a donation, shown as `surplus`).
//! Decimals are copied from the XLM SAC (7) and enforced at construction.
//!
//! ## Holder yield — paid from a pre-funded reserve, never minted
//! Holders earn a nominal APR (hard-capped at [`MAX_APR_BPS`]) that accrues
//! **per second held** (time-weighted). The yield is **transferred out of the
//! reward reserve** (QFX that was itself minted against deposited XLM), so
//! paying it never changes total supply or the backing. When the reserve is
//! empty, yield stops; it never goes negative.
//!
//! MasterChef-style accounting: a global `acc` (1e18 fixed point, QFX earned
//! per QFX held) grows continuously by
//! `apr * min(eligible, max_eligible) / eligible * seconds / year` (capped by
//! the reserve). Every balance change first accrues and credits the account's
//! pending yield `balance * (acc - checkpoint)`, so an account earns exactly
//! for the seconds it held its balance — a deposit held for 120 s earns 120 s
//! of yield (F-03 fix; the previous version paid a full day to whoever held
//! at the UTC-day boundary).
//!
//! **Bounded liability (F-13):** only `max_eligible` QFX (configurable, e.g.
//! 1,000,000 QFX) earns the full APR. Above that, the same total emission is
//! shared pro rata, so the reserve drain rate is at most
//! `max_eligible * apr / year` no matter how much QFX exists, and the
//! effective APR (`yield_info().effective_apr_bps`) falls accordingly.
//! Changing the APR or the cap is timelocked.
//!
//! Admin-marked contracts (e.g. the staking contract, whose internal
//! accounting cannot absorb yield) are `yield_exempt`. Rounding favours the
//! reserve.
//!
//! ## Governance
//! Two-step admin transfer; guardian pause blocks `deposit` (minting) only —
//! `redeem`, `burn`, transfers and yield settlement always work; timelocked
//! `SetAprBps`, `SetMaxEligible`, `Upgrade`, `SetDelay`.
#![no_std]
// The Soroban constructor takes 7 config args + env; the SDK generates free
// wrapper fns for it, so the lint can only be silenced crate-wide.
#![allow(clippy::too_many_arguments)]

use quasaria_gov as gov;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, Env, MuxedAddress, String,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(
    key = "desc",
    val = "Quasaria Flux (QFX): 1 QFX = 1 XLM, fully backed; holder yield paid from a pre-funded reserve"
);
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

pub const SCALE: i128 = 1_000_000_000_000_000_000; // 1e18
pub const DAY_SECONDS: u64 = 86_400;
pub const YEAR_SECONDS: i128 = 365 * 86_400;
/// Hard cap on the admin-configurable nominal holder APR (basis points).
pub const MAX_APR_BPS: u32 = 2_500;
/// XLM (and therefore QFX) decimals.
pub const XLM_DECIMALS: u32 = 7;
const BPS: i128 = 10_000;

const BAL_BUMP_THRESHOLD: u32 = gov::PERSISTENT_BUMP_THRESHOLD;
const BAL_BUMP_TO: u32 = gov::PERSISTENT_BUMP_TO;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    NegativeAmount = 1,
    InsufficientBalance = 2,
    InsufficientAllowance = 3,
    AprTooHigh = 4,
    InvalidExpiration = 6,
    ZeroAmount = 8,
    /// Defence in depth: the XLM held no longer covers total supply.
    NotBacked = 9,
    /// The collateral SAC does not use 7 decimals (not native XLM).
    InvalidDecimals = 10,
    /// `max_eligible` must be positive.
    InvalidCap = 11,
}

/// Timelocked admin actions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum QfxAction {
    SetAprBps(u32),
    SetMaxEligible(i128),
    Upgrade(BytesN<32>),
    SetDelay(u64),
    SetGuardian(Address),
    /// (holder, exempt): exclude or re-include a holder from holder yield.
    /// Timelocked because it silently changes a holder's yield.
    SetYieldExempt(Address, bool),
}

impl gov::TimelockAction for QfxAction {
    fn delay_class(&self) -> gov::DelayClass {
        match self {
            QfxAction::Upgrade(_) | QfxAction::SetDelay(_) => gov::DelayClass::Critical,
            QfxAction::SetAprBps(_)
            | QfxAction::SetMaxEligible(_)
            | QfxAction::SetGuardian(_)
            | QfxAction::SetYieldExempt(_, _) => gov::DelayClass::Standard,
        }
    }
    fn validate(&self, env: &Env) {
        match self {
            QfxAction::SetAprBps(apr) => check_apr(env, *apr),
            QfxAction::SetMaxEligible(cap) => check_cap(env, *cap),
            QfxAction::SetDelay(d) => gov::check_delay(env, *d),
            _ => {}
        }
    }
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Xlm,
    Name,
    Symbol,
    Decimals,
    AprBps,
    MaxEligible,
    Genesis,
    LastUpdate,
    Acc,
    TotalSupply,
    Eligible,
    YieldPool,
    YieldAllocated,
    Holder(Address),
    Exempt(Address),
    Allowance(Address, Address),
}

#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Holder {
    pub balance: i128,
    pub checkpoint: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub live_until_ledger: u32,
}

/// Proof-of-reserves view: `xlm_reserve` (the contract's live XLM balance in
/// the native SAC) vs `total_supply`. `fully_backed` = reserve ≥ supply;
/// `surplus` = reserve − supply (0 unless XLM was donated).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reserves {
    pub xlm_reserve: i128,
    pub total_supply: i128,
    pub surplus: i128,
    pub fully_backed: bool,
    /// QFX held for holder yield (unallocated + accrued-but-unsettled).
    pub reward_reserve: i128,
    /// total_supply − reward_reserve.
    pub circulating: i128,
}

/// Holder-yield configuration + reserve runway for UIs / bots.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct YieldInfo {
    pub apr_bps: u32,
    pub apy_bps: u32,
    pub max_apr_bps: u32,
    pub acc: i128,
    pub genesis: u64,
    /// Ledger timestamp the accumulator was last advanced to.
    pub last_update: u64,
    /// Yield accrues continuously; kept for UI compatibility (= now).
    pub next_accrual_at: u64,
    /// Unallocated reward reserve (QFX).
    pub reward_pool: i128,
    /// Accrued to holders, not yet credited to stored balances.
    pub accrued_unsettled: i128,
    /// Balances earning yield (non-exempt holders).
    pub eligible_supply: i128,
    /// Eligible supply that earns the full APR (liability cap).
    pub max_eligible: i128,
    /// APR actually earned per QFX after the cap dilution (bps).
    pub effective_apr_bps: u32,
    /// Yield paid per day at the current APR and (capped) eligible supply.
    pub daily_emission: i128,
    /// Seconds until the unallocated reserve is exhausted at the current
    /// emission rate (u64::MAX if nothing is being emitted).
    pub runway_seconds: u64,
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

#[contractevent(topics = ["deposit"], data_format = "single-value")]
pub struct Deposit {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["redeem"], data_format = "single-value")]
pub struct Redeem {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["yield_funded"])]
pub struct YieldFunded {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub from_xlm: bool,
}

#[contractevent(topics = ["yield_paid"], data_format = "single-value")]
pub struct YieldPaid {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["accrued"])]
pub struct Accrued {
    pub timestamp: u64,
    pub acc: i128,
    pub emission: i128,
}

#[contractevent(topics = ["cap_set"], data_format = "single-value")]
pub struct CapSet {
    pub max_eligible: i128,
}

#[contractevent(topics = ["rate_set"], data_format = "single-value")]
pub struct RateSet {
    pub apr_bps: u32,
}

#[contractevent(topics = ["exempt_set"], data_format = "single-value")]
pub struct ExemptSet {
    #[topic]
    pub id: Address,
    pub exempt: bool,
}

// ---------------------------------------------------------------- math

/// floor(a * b / c) with a 256-bit intermediate (panics only if the result
/// itself overflows i128).
pub fn mul_div_floor(env: &Env, a: i128, b: i128, c: i128) -> i128 {
    gov::mul_div_floor(env, a, b, c)
}

/// ceil(a * b / c) with a 256-bit intermediate.
fn mul_div_ceil(env: &Env, a: i128, b: i128, c: i128) -> i128 {
    gov::mul_div_ceil(env, a, b, c)
}

/// (base / SCALE) ^ exp in SCALE fixed point, exponentiation by squaring.
pub fn pow_fixed(env: &Env, base: i128, mut exp: u64) -> i128 {
    let mut result = SCALE;
    let mut b = base;
    while exp > 0 {
        if exp & 1 == 1 {
            result = mul_div_floor(env, result, b, SCALE);
        }
        exp >>= 1;
        if exp > 0 {
            b = mul_div_floor(env, b, b, SCALE);
        }
    }
    result
}

/// Daily growth factor (SCALE fixed point) for a nominal APR.
pub fn daily_factor(env: &Env, apr_bps: u32) -> i128 {
    gov::add(
        env,
        SCALE,
        mul_div_floor(env, i128::from(apr_bps), SCALE, BPS * 365),
    )
}

// ---------------------------------------------------------------- storage helpers

fn inst_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0)
}

fn add_i128(env: &Env, key: &DataKey, delta: i128) {
    let v = gov::add(env, inst_i128(env, key), delta);
    env.storage().instance().set(key, &v);
}

fn bump_instance(env: &Env) {
    gov::bump_instance(env);
}

fn load_holder(env: &Env, id: &Address) -> Holder {
    let key = DataKey::Holder(id.clone());
    match env.storage().persistent().get::<DataKey, Holder>(&key) {
        Some(h) => {
            env.storage()
                .persistent()
                .extend_ttl(&key, BAL_BUMP_THRESHOLD, BAL_BUMP_TO);
            h
        }
        None => Holder::default(),
    }
}

fn save_holder(env: &Env, id: &Address, h: &Holder) {
    let key = DataKey::Holder(id.clone());
    env.storage().persistent().set(&key, h);
    env.storage()
        .persistent()
        .extend_ttl(&key, BAL_BUMP_THRESHOLD, BAL_BUMP_TO);
}

fn is_exempt(env: &Env, id: &Address) -> bool {
    let key = DataKey::Exempt(id.clone());
    let v = env.storage().persistent().get(&key).unwrap_or(false);
    gov::bump_persistent(env, &key);
    v
}

fn xlm_addr(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Xlm)
        .unwrap_or_else(|| panic_with_error!(env, TokenError::InvalidDecimals))
}

fn xlm(env: &Env) -> token::Client<'_> {
    token::Client::new(env, &xlm_addr(env))
}

fn check_nonneg(env: &Env, amount: i128) {
    if amount < 0 {
        panic_with_error!(env, TokenError::NegativeAmount);
    }
}

fn check_positive(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, TokenError::ZeroAmount);
    }
}

/// Defence in depth: the XLM held must cover every QFX in existence.
fn assert_backed(env: &Env) {
    let reserve = xlm(env).balance(&env.current_contract_address());
    if reserve < inst_i128(env, &DataKey::TotalSupply) {
        panic_with_error!(env, TokenError::NotBacked);
    }
}

// ---------------------------------------------------------------- yield accounting

fn apr(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::AprBps).unwrap_or(0)
}

fn max_eligible(env: &Env) -> i128 {
    inst_i128(env, &DataKey::MaxEligible)
}

/// Per-second emission (SCALE fixed point, QFX-stroops * 1e18 per second)
/// at the current APR and capped eligible supply.
fn emission_rate_scaled(env: &Env, eligible: i128) -> i128 {
    let base = eligible.min(max_eligible(env)).max(0);
    mul_div_floor(env, gov::mul(env, base, i128::from(apr(env))), SCALE, BPS * YEAR_SECONDS)
}

/// (acc, timestamp, emission) including all elapsed seconds, without writing.
///
/// Time-weighted: `acc` grows by `apr * min(eligible, cap) / eligible` per
/// second (scaled by 1e18). `emission` (rounded **up**, so allocations always
/// cover what holders can claim) moves from the unallocated pool to the
/// allocated bucket; if it would exceed the pool, only the pool is
/// distributed.
fn projected(env: &Env) -> (i128, u64, i128) {
    let st = env.storage().instance();
    let acc: i128 = st.get(&DataKey::Acc).unwrap_or(0);
    let last: u64 = st.get(&DataKey::LastUpdate).unwrap_or(0);
    let now = env.ledger().timestamp();
    if now <= last {
        return (acc, last, 0);
    }
    let eligible = inst_i128(env, &DataKey::Eligible);
    let pool = inst_i128(env, &DataKey::YieldPool);
    if eligible <= 0 || pool <= 0 || apr(env) == 0 {
        return (acc, now, 0);
    }
    let dt = i128::from(now.saturating_sub(last));
    // acc increment per QFX-stroop held, 1e18 fixed point
    let rate = emission_rate_scaled(env, eligible);
    let mut inc = mul_div_floor(env, rate, dt, eligible);
    let mut emission = mul_div_ceil(env, inc, eligible, SCALE);
    if emission > pool {
        emission = pool;
        inc = mul_div_floor(env, pool, SCALE, eligible);
    }
    if inc <= 0 {
        // Too little time for a representable increment: do not advance the
        // clock, so frequent pokes cannot erase yield by rounding.
        return (acc, last, 0);
    }
    (gov::add(env, acc, inc), now, emission)
}

/// Persist the projected accumulator. Must run before any balance change.
fn accrue(env: &Env) -> i128 {
    let (acc, ts, emission) = projected(env);
    let st = env.storage().instance();
    let last: u64 = st.get(&DataKey::LastUpdate).unwrap_or(0);
    if ts != last {
        st.set(&DataKey::Acc, &acc);
        st.set(&DataKey::LastUpdate, &ts);
        if emission > 0 {
            add_i128(env, &DataKey::YieldPool, gov::sub(env, 0, emission));
            add_i128(env, &DataKey::YieldAllocated, emission);
            Accrued {
                timestamp: ts,
                acc,
                emission,
            }
            .publish(env);
        }
    }
    acc
}

fn pending_of(env: &Env, h: &Holder, acc: i128, exempt: bool) -> i128 {
    if exempt || h.balance <= 0 || acc <= h.checkpoint {
        0
    } else {
        mul_div_floor(env, h.balance, gov::sub(env, acc, h.checkpoint), SCALE)
    }
}

/// Load a holder and credit their pending yield (from the allocated reserve)
/// into the in-memory balance. Caller must `save_holder` afterwards.
fn touch(env: &Env, id: &Address, acc: i128) -> (Holder, bool) {
    let mut h = load_holder(env, id);
    let exempt = is_exempt(env, id);
    let p = pending_of(env, &h, acc, exempt);
    if p > 0 {
        h.balance = gov::add(env, h.balance, p);
        add_i128(env, &DataKey::Eligible, p);
        add_i128(env, &DataKey::YieldAllocated, gov::sub(env, 0, p));
        YieldPaid {
            to: id.clone(),
            amount: p,
        }
        .publish(env);
    }
    h.checkpoint = acc;
    (h, exempt)
}

fn credit(env: &Env, id: &Address, acc: i128, amount: i128) {
    let (mut h, exempt) = touch(env, id, acc);
    h.balance = gov::add(env, h.balance, amount);
    if !exempt {
        add_i128(env, &DataKey::Eligible, amount);
    }
    save_holder(env, id, &h);
}

fn debit(env: &Env, id: &Address, acc: i128, amount: i128) {
    let (mut h, exempt) = touch(env, id, acc);
    if h.balance < amount {
        panic_with_error!(env, TokenError::InsufficientBalance);
    }
    h.balance = gov::sub(env, h.balance, amount);
    if !exempt {
        add_i128(env, &DataKey::Eligible, gov::sub(env, 0, amount));
    }
    save_holder(env, id, &h);
}

fn move_tokens(env: &Env, from: &Address, to: &Address, amount: i128) {
    check_nonneg(env, amount);
    let acc = accrue(env);
    debit(env, from, acc, amount);
    credit(env, to, acc, amount);
}

/// Burn `amount` QFX from `from` and send the same amount of XLM back to `from`.
fn redeem_inner(env: &Env, from: &Address, amount: i128) {
    check_positive(env, amount);
    let acc = accrue(env);
    debit(env, from, acc, amount);
    add_i128(env, &DataKey::TotalSupply, gov::sub(env, 0, amount));
    xlm(env).transfer(&env.current_contract_address(), from, &amount);
    assert_backed(env);
    bump_instance(env);
    Burn {
        from: from.clone(),
        amount,
    }
    .publish(env);
    Redeem {
        from: from.clone(),
        amount,
    }
    .publish(env);
}

fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(from.clone(), spender.clone());
    match env
        .storage()
        .temporary()
        .get::<DataKey, AllowanceValue>(&key)
    {
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
                amount: gov::sub(env, a.amount, amount),
                live_until_ledger: a.live_until_ledger,
            },
        );
    }
}

// ---------------------------------------------------------------- contract

fn check_apr(env: &Env, apr_bps: u32) {
    if apr_bps > MAX_APR_BPS {
        panic_with_error!(env, TokenError::AprTooHigh);
    }
}

fn check_cap(env: &Env, cap: i128) {
    if cap <= 0 {
        panic_with_error!(env, TokenError::InvalidCap);
    }
}

#[contract]
pub struct QuasariaFlux;

/// Exclude (or re-include) an address from holder yield — for contracts such
/// as staking whose internal accounting cannot absorb it. Applied only from
/// the timelocked `QfxAction::SetYieldExempt`.
fn set_yield_exempt_now(env: &Env, id: Address, exempt: bool) {
    let acc = accrue(env);
    let (h, was) = touch(env, &id, acc);
    if was != exempt {
        add_i128(
            env,
            &DataKey::Eligible,
            if exempt {
                gov::sub(env, 0, h.balance)
            } else {
                h.balance
            },
        );
        let key = DataKey::Exempt(id.clone());
        env.storage().persistent().set(&key, &exempt);
        gov::bump_persistent(env, &key);
    }
    save_holder(env, &id, &h);
    bump_instance(env);
    ExemptSet { id, exempt }.publish(env);
}

quasaria_gov::governance_entrypoints!(QuasariaFlux, QfxAction);
quasaria_gov::pause_entrypoints!(QuasariaFlux);

#[contractimpl]
impl QuasariaFlux {
    /// `xlm` must be the native XLM Stellar Asset Contract (7 decimals).
    /// `max_eligible`: QFX (stroops) that earns the full APR (liability cap).
    pub fn __constructor(
        env: Env,
        admin: Address,
        xlm: Address,
        name: String,
        symbol: String,
        apr_bps: u32,
        max_eligible: i128,
        timelock_delay: u64,
    ) {
        check_apr(&env, apr_bps);
        check_cap(&env, max_eligible);
        let decimals = token::Client::new(&env, &xlm).decimals();
        if decimals != XLM_DECIMALS {
            panic_with_error!(&env, TokenError::InvalidDecimals);
        }
        gov::init(&env, &admin, timelock_delay);
        let st = env.storage().instance();
        st.set(&DataKey::Xlm, &xlm);
        st.set(&DataKey::Decimals, &decimals);
        st.set(&DataKey::Name, &name);
        st.set(&DataKey::Symbol, &symbol);
        st.set(&DataKey::AprBps, &apr_bps);
        st.set(&DataKey::MaxEligible, &max_eligible);
        st.set(&DataKey::Genesis, &env.ledger().timestamp());
        st.set(&DataKey::LastUpdate, &env.ledger().timestamp());
        st.set(&DataKey::Acc, &0i128);
        st.set(&DataKey::TotalSupply, &0i128);
        st.set(&DataKey::Eligible, &0i128);
        st.set(&DataKey::YieldPool, &0i128);
        st.set(&DataKey::YieldAllocated, &0i128);
        bump_instance(&env);
    }

    // ----- peg: the only ways QFX supply changes

    /// Pull `amount` native XLM from `from` (via the XLM SAC) and mint the
    /// same amount of QFX to `from`. Returns the QFX minted. Paused by the
    /// guardian (redeem never is).
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();
        gov::when_not_paused(&env);
        check_positive(&env, amount);
        let acc = accrue(&env);
        xlm(&env).transfer(&from, env.current_contract_address(), &amount);
        credit(&env, &from, acc, amount);
        add_i128(&env, &DataKey::TotalSupply, amount);
        assert_backed(&env);
        bump_instance(&env);
        Mint {
            to: from.clone(),
            amount,
        }
        .publish(&env);
        Deposit { from, amount }.publish(&env);
        amount
    }

    /// Burn `amount` QFX from `from` and return the same amount of native XLM.
    /// Fails with `InsufficientBalance` if `from` holds less.
    pub fn redeem(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();
        redeem_inner(&env, &from, amount);
        amount
    }

    /// Top up the holder-yield reserve with XLM: pulls `amount` XLM and mints
    /// the same amount of QFX into the reserve (backed, like `deposit`).
    pub fn fund_yield(env: Env, from: Address, amount: i128) {
        from.require_auth();
        check_positive(&env, amount);
        accrue(&env);
        xlm(&env).transfer(&from, env.current_contract_address(), &amount);
        add_i128(&env, &DataKey::TotalSupply, amount);
        add_i128(&env, &DataKey::YieldPool, amount);
        assert_backed(&env);
        bump_instance(&env);
        Mint {
            to: env.current_contract_address(),
            amount,
        }
        .publish(&env);
        YieldFunded {
            from,
            amount,
            from_xlm: true,
        }
        .publish(&env);
    }

    /// Top up the holder-yield reserve with existing QFX (e.g. protocol
    /// fees). Supply is unchanged.
    pub fn fund_yield_qfx(env: Env, from: Address, amount: i128) {
        from.require_auth();
        check_positive(&env, amount);
        let acc = accrue(&env);
        debit(&env, &from, acc, amount);
        add_i128(&env, &DataKey::YieldPool, amount);
        bump_instance(&env);
        YieldFunded {
            from,
            amount,
            from_xlm: false,
        }
        .publish(&env);
    }

    /// Permissionless: XLM sent to this contract outside `deposit` is
    /// surplus collateral. Mint exactly that much QFX into the yield reserve
    /// so it benefits holders. Returns the amount swept.
    pub fn sweep_surplus(env: Env) -> i128 {
        accrue(&env);
        let reserve = xlm(&env).balance(&env.current_contract_address());
        let surplus = gov::sub(&env, reserve, inst_i128(&env, &DataKey::TotalSupply));
        if surplus > 0 {
            add_i128(&env, &DataKey::TotalSupply, surplus);
            add_i128(&env, &DataKey::YieldPool, surplus);
            Mint {
                to: env.current_contract_address(),
                amount: surplus,
            }
            .publish(&env);
        }
        bump_instance(&env);
        if surplus > 0 {
            surplus
        } else {
            0
        }
    }

    // ----- admin (cannot create QFX)

    /// Apply a queued timelocked action after its delay. APR / cap changes
    /// accrue first so the old parameters apply to all elapsed time.
    pub fn execute_action(env: Env, action: QfxAction) {
        gov::consume(&env, &action);
        match action {
            QfxAction::SetAprBps(apr_bps) => {
                check_apr(&env, apr_bps);
                accrue(&env);
                env.storage().instance().set(&DataKey::AprBps, &apr_bps);
                RateSet { apr_bps }.publish(&env);
            }
            QfxAction::SetMaxEligible(cap) => {
                check_cap(&env, cap);
                accrue(&env);
                env.storage().instance().set(&DataKey::MaxEligible, &cap);
                CapSet { max_eligible: cap }.publish(&env);
            }
            QfxAction::Upgrade(hash) => gov::upgrade_now(&env, &hash),
            QfxAction::SetDelay(d) => gov::set_delay_now(&env, d),
            QfxAction::SetGuardian(g) => gov::set_guardian_now(&env, &g),
            QfxAction::SetYieldExempt(id, exempt) => set_yield_exempt_now(&env, id, exempt),
        }
    }

    // (No instant `set_yield_exempt`: use `QfxAction::SetYieldExempt`.)


    // ----- permissionless keepers

    /// Persist the accumulator (keepers may call daily). Returns `acc`.
    pub fn accrue(env: Env) -> i128 {
        bump_instance(&env);
        accrue(&env)
    }

    /// Credit `id`'s pending yield into its balance (compounds it).
    pub fn settle(env: Env, id: Address) -> i128 {
        let acc = accrue(&env);
        let before = load_holder(&env, &id).balance;
        let (h, _) = touch(&env, &id, acc);
        save_holder(&env, &id, &h);
        bump_instance(&env);
        gov::sub(&env, h.balance, before)
    }

    // ----- views

    pub fn xlm(env: Env) -> Address {
        xlm_addr(&env)
    }

    pub fn total_supply(env: Env) -> i128 {
        inst_i128(&env, &DataKey::TotalSupply)
    }

    /// Proof of reserves: live XLM held vs QFX supply.
    pub fn reserves(env: Env) -> Reserves {
        let xlm_reserve = xlm(&env).balance(&env.current_contract_address());
        let total_supply = inst_i128(&env, &DataKey::TotalSupply);
        let reward_reserve = gov::add(
            &env,
            inst_i128(&env, &DataKey::YieldPool),
            inst_i128(&env, &DataKey::YieldAllocated),
        );
        Reserves {
            xlm_reserve,
            total_supply,
            surplus: gov::sub(&env, xlm_reserve, total_supply),
            fully_backed: xlm_reserve >= total_supply,
            reward_reserve,
            circulating: gov::sub(&env, total_supply, reward_reserve),
        }
    }

    pub fn pending_yield(env: Env, id: Address) -> i128 {
        let (acc, _, _) = projected(&env);
        pending_of(&env, &load_holder(&env, &id), acc, is_exempt(&env, &id))
    }

    pub fn is_yield_exempt(env: Env, id: Address) -> bool {
        is_exempt(&env, &id)
    }

    /// APY in bps if yield is settled (compounded) daily.
    pub fn current_apy_bps(env: Env) -> u32 {
        let f = pow_fixed(&env, daily_factor(&env, apr(&env)), 365);
        let bps = mul_div_floor(&env, gov::sub(&env, f, SCALE), BPS, SCALE);
        u32::try_from(bps).unwrap_or(u32::MAX)
    }

    pub fn yield_info(env: Env) -> YieldInfo {
        let st = env.storage().instance();
        let (acc, last_update, emission) = projected(&env);
        let apr_bps = apr(&env);
        let genesis: u64 = st.get(&DataKey::Genesis).unwrap_or(0);
        let eligible = inst_i128(&env, &DataKey::Eligible);
        let cap = max_eligible(&env);
        let effective = if eligible > cap && eligible > 0 {
            mul_div_floor(&env, i128::from(apr_bps), cap, eligible)
        } else {
            i128::from(apr_bps)
        };
        let per_sec_scaled = emission_rate_scaled(&env, eligible);
        let reward_pool = gov::sub(&env, inst_i128(&env, &DataKey::YieldPool), emission);
        let daily = mul_div_floor(&env, per_sec_scaled, i128::from(DAY_SECONDS), SCALE);
        let runway = if per_sec_scaled > 0 {
            let secs = mul_div_floor(&env, reward_pool, SCALE, per_sec_scaled);
            u64::try_from(secs).unwrap_or(u64::MAX)
        } else {
            u64::MAX
        };
        YieldInfo {
            apr_bps,
            apy_bps: Self::current_apy_bps(env.clone()),
            max_apr_bps: MAX_APR_BPS,
            acc,
            genesis,
            last_update,
            next_accrual_at: env.ledger().timestamp(),
            reward_pool,
            accrued_unsettled: gov::add(&env, inst_i128(&env, &DataKey::YieldAllocated), emission),
            eligible_supply: eligible,
            max_eligible: cap,
            effective_apr_bps: u32::try_from(effective).unwrap_or(u32::MAX),
            daily_emission: daily,
            runway_seconds: runway,
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
            let live_for = live_until_ledger.saturating_sub(env.ledger().sequence());
            env.storage()
                .temporary()
                .extend_ttl(&key, live_for, live_for);
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

    /// Stored balance + yield accrued so far (credited on next touch).
    fn balance(env: Env, id: Address) -> i128 {
        let (acc, _, _) = projected(&env);
        let h = load_holder(&env, &id);
        gov::add(&env, h.balance, pending_of(&env, &h, acc, is_exempt(&env, &id)))
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

    /// Burning QFX redeems it: the same amount of XLM goes back to `from`.
    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        redeem_inner(&env, &from, amount);
    }

    /// Burning QFX redeems it: the same amount of XLM goes back to `from`.
    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        check_nonneg(&env, amount);
        spend_allowance(&env, &from, &spender, amount);
        redeem_inner(&env, &from, amount);
    }

    fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(XLM_DECIMALS)
    }

    fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "Quasaria Flux"))
    }

    fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "QFX"))
    }
}

#[cfg(test)]
mod test;
