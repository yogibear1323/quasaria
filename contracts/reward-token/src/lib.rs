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
//! Holders earn a nominal APR (admin-set, hard-capped at [`MAX_APR_BPS`]),
//! accounted once per elapsed UTC day (counted from `genesis`). The yield is
//! **transferred out of the reward reserve** (QFX that was itself minted
//! against deposited XLM), so paying it never changes total supply or the
//! backing. When the reserve is empty, yield stops; it never goes negative.
//!
//! MasterChef-style accounting: a global `acc` (1e18 fixed point, QFX earned
//! per QFX held) grows by `min(eligible * ((1+apr/365)^days - 1), reserve) /
//! eligible` on each accrual. A holder's pending yield is
//! `balance * (acc - checkpoint)`, shown in `balance()` immediately and
//! credited (compounded) whenever the holder's balance is touched (transfer,
//! deposit, redeem) or anyone calls the permissionless `settle`.
//! Admin-marked contracts (e.g. the staking contract, whose internal
//! accounting cannot absorb yield) are `yield_exempt`. Rounding favours the
//! reserve.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, MuxedAddress, String,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(
    key = "desc",
    val = "Quasaria Flux (QFX): 1 QFX = 1 XLM, fully backed; holder yield paid from a pre-funded reserve"
);
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

pub const SCALE: i128 = 1_000_000_000_000_000_000; // 1e18
pub const DAY_SECONDS: u64 = 86_400;
/// Hard cap on the admin-configurable nominal holder APR (basis points).
pub const MAX_APR_BPS: u32 = 2_500;
/// XLM (and therefore QFX) decimals.
pub const XLM_DECIMALS: u32 = 7;
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
    InvalidExpiration = 6,
    ZeroAmount = 8,
    /// Defence in depth: the XLM held no longer covers total supply.
    NotBacked = 9,
    /// The collateral SAC does not use 7 decimals (not native XLM).
    InvalidDecimals = 10,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Xlm,
    Name,
    Symbol,
    Decimals,
    AprBps,
    Genesis,
    LastDay,
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
    pub last_day: u64,
    pub next_accrual_at: u64,
    /// Unallocated reward reserve (QFX).
    pub reward_pool: i128,
    /// Accrued to holders, not yet credited to stored balances.
    pub accrued_unsettled: i128,
    /// Balances earning yield (non-exempt holders).
    pub eligible_supply: i128,
    /// Yield paid per day at the current APR and eligible supply.
    pub daily_emission: i128,
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
    pub day: u64,
    pub acc: i128,
    pub emission: i128,
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

/// floor(a * b / c) without intermediate overflow for our value ranges.
pub fn mul_div_floor(a: i128, b: i128, c: i128) -> i128 {
    match a.checked_mul(b) {
        Some(p) => p / c,
        None => (a / c) * b + (a % c) * b / c,
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

fn inst_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0)
}

fn add_i128(env: &Env, key: &DataKey, delta: i128) {
    let v = inst_i128(env, key) + delta;
    env.storage().instance().set(key, &v);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_TO);
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
    env.storage()
        .persistent()
        .get(&DataKey::Exempt(id.clone()))
        .unwrap_or(false)
}

fn xlm(env: &Env) -> token::Client<'_> {
    let a: Address = env.storage().instance().get(&DataKey::Xlm).unwrap();
    token::Client::new(env, &a)
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

/// (acc, day, emission) including all pending days, without writing.
fn projected(env: &Env) -> (i128, u64, i128) {
    let st = env.storage().instance();
    let acc: i128 = st.get(&DataKey::Acc).unwrap_or(0);
    let last_day: u64 = st.get(&DataKey::LastDay).unwrap_or(0);
    let genesis: u64 = st.get(&DataKey::Genesis).unwrap_or(0);
    let today = env.ledger().timestamp().saturating_sub(genesis) / DAY_SECONDS;
    if today <= last_day {
        return (acc, last_day, 0);
    }
    let eligible = inst_i128(env, &DataKey::Eligible);
    let pool = inst_i128(env, &DataKey::YieldPool);
    let apr: u32 = st.get(&DataKey::AprBps).unwrap_or(0);
    if eligible <= 0 || pool <= 0 || apr == 0 {
        return (acc, today, 0);
    }
    let growth = pow_fixed(daily_factor(apr), today - last_day) - SCALE;
    let mut emission = mul_div_floor(eligible, growth, SCALE);
    if emission > pool {
        emission = pool; // the reserve is the hard limit: never mint yield
    }
    let inc = mul_div_floor(emission, SCALE, eligible);
    (acc + inc, today, emission)
}

/// Persist the projected accumulator. Must run before any balance change.
fn accrue(env: &Env) -> i128 {
    let (acc, day, emission) = projected(env);
    let st = env.storage().instance();
    let last_day: u64 = st.get(&DataKey::LastDay).unwrap_or(0);
    if day != last_day {
        st.set(&DataKey::Acc, &acc);
        st.set(&DataKey::LastDay, &day);
        if emission > 0 {
            add_i128(env, &DataKey::YieldPool, -emission);
            add_i128(env, &DataKey::YieldAllocated, emission);
        }
        Accrued { day, acc, emission }.publish(env);
    }
    acc
}

fn pending_of(h: &Holder, acc: i128, exempt: bool) -> i128 {
    if exempt || h.balance <= 0 || acc <= h.checkpoint {
        0
    } else {
        mul_div_floor(h.balance, acc - h.checkpoint, SCALE)
    }
}

/// Load a holder and credit their pending yield (from the allocated reserve)
/// into the in-memory balance. Caller must `save_holder` afterwards.
fn touch(env: &Env, id: &Address, acc: i128) -> (Holder, bool) {
    let mut h = load_holder(env, id);
    let exempt = is_exempt(env, id);
    let p = pending_of(&h, acc, exempt);
    if p > 0 {
        h.balance += p;
        add_i128(env, &DataKey::Eligible, p);
        add_i128(env, &DataKey::YieldAllocated, -p);
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
    h.balance += amount;
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
    h.balance -= amount;
    if !exempt {
        add_i128(env, &DataKey::Eligible, -amount);
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
    add_i128(env, &DataKey::TotalSupply, -amount);
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
    /// `xlm` must be the native XLM Stellar Asset Contract (7 decimals).
    pub fn __constructor(
        env: Env,
        admin: Address,
        xlm: Address,
        name: String,
        symbol: String,
        apr_bps: u32,
    ) {
        if apr_bps > MAX_APR_BPS {
            panic_with_error!(&env, TokenError::AprTooHigh);
        }
        let decimals = token::Client::new(&env, &xlm).decimals();
        if decimals != XLM_DECIMALS {
            panic_with_error!(&env, TokenError::InvalidDecimals);
        }
        let st = env.storage().instance();
        st.set(&DataKey::Admin, &admin);
        st.set(&DataKey::Xlm, &xlm);
        st.set(&DataKey::Decimals, &decimals);
        st.set(&DataKey::Name, &name);
        st.set(&DataKey::Symbol, &symbol);
        st.set(&DataKey::AprBps, &apr_bps);
        st.set(&DataKey::Genesis, &env.ledger().timestamp());
        st.set(&DataKey::LastDay, &0u64);
        st.set(&DataKey::Acc, &0i128);
        st.set(&DataKey::TotalSupply, &0i128);
        st.set(&DataKey::Eligible, &0i128);
        st.set(&DataKey::YieldPool, &0i128);
        st.set(&DataKey::YieldAllocated, &0i128);
        bump_instance(&env);
    }

    // ----- peg: the only ways QFX supply changes

    /// Pull `amount` native XLM from `from` (via the XLM SAC) and mint the
    /// same amount of QFX to `from`. Returns the QFX minted.
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();
        check_positive(&env, amount);
        let acc = accrue(&env);
        xlm(&env).transfer(&from, &env.current_contract_address(), &amount);
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
        xlm(&env).transfer(&from, &env.current_contract_address(), &amount);
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
        let surplus = reserve - inst_i128(&env, &DataKey::TotalSupply);
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

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        Self::admin(env.clone()).require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
    }

    /// Set the nominal holder APR (bps). Accrues first so the old rate applies
    /// to all fully elapsed days. Paid only while the reserve lasts.
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

    /// Exclude (or re-include) an address from holder yield — for contracts
    /// such as staking whose internal accounting cannot absorb it.
    pub fn set_yield_exempt(env: Env, id: Address, exempt: bool) {
        Self::admin(env.clone()).require_auth();
        let acc = accrue(&env);
        let (h, was) = touch(&env, &id, acc);
        if was != exempt {
            add_i128(
                &env,
                &DataKey::Eligible,
                if exempt { -h.balance } else { h.balance },
            );
            env.storage()
                .persistent()
                .set(&DataKey::Exempt(id.clone()), &exempt);
        }
        save_holder(&env, &id, &h);
        bump_instance(&env);
        ExemptSet { id, exempt }.publish(&env);
    }

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
        h.balance - before
    }

    // ----- views

    pub fn xlm(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Xlm).unwrap()
    }

    pub fn total_supply(env: Env) -> i128 {
        inst_i128(&env, &DataKey::TotalSupply)
    }

    /// Proof of reserves: live XLM held vs QFX supply.
    pub fn reserves(env: Env) -> Reserves {
        let xlm_reserve = xlm(&env).balance(&env.current_contract_address());
        let total_supply = inst_i128(&env, &DataKey::TotalSupply);
        let reward_reserve =
            inst_i128(&env, &DataKey::YieldPool) + inst_i128(&env, &DataKey::YieldAllocated);
        Reserves {
            xlm_reserve,
            total_supply,
            surplus: xlm_reserve - total_supply,
            fully_backed: xlm_reserve >= total_supply,
            reward_reserve,
            circulating: total_supply - reward_reserve,
        }
    }

    pub fn pending_yield(env: Env, id: Address) -> i128 {
        let (acc, _, _) = projected(&env);
        pending_of(&load_holder(&env, &id), acc, is_exempt(&env, &id))
    }

    pub fn is_yield_exempt(env: Env, id: Address) -> bool {
        is_exempt(&env, &id)
    }

    /// Effective APY in bps from daily compounding of the nominal APR.
    pub fn current_apy_bps(env: Env) -> u32 {
        let apr: u32 = env.storage().instance().get(&DataKey::AprBps).unwrap_or(0);
        let f = pow_fixed(daily_factor(apr), 365);
        ((f - SCALE) * BPS / SCALE) as u32
    }

    pub fn yield_info(env: Env) -> YieldInfo {
        let st = env.storage().instance();
        let (acc, last_day, emission) = projected(&env);
        let apr: u32 = st.get(&DataKey::AprBps).unwrap_or(0);
        let genesis: u64 = st.get(&DataKey::Genesis).unwrap_or(0);
        let eligible = inst_i128(&env, &DataKey::Eligible);
        YieldInfo {
            apr_bps: apr,
            apy_bps: Self::current_apy_bps(env.clone()),
            max_apr_bps: MAX_APR_BPS,
            acc,
            genesis,
            last_day,
            next_accrual_at: genesis + (last_day + 1) * DAY_SECONDS,
            reward_pool: inst_i128(&env, &DataKey::YieldPool) - emission,
            accrued_unsettled: inst_i128(&env, &DataKey::YieldAllocated) + emission,
            eligible_supply: eligible,
            daily_emission: eligible * (apr as i128) / (BPS * 365),
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
        h.balance + pending_of(&h, acc, is_exempt(&env, &id))
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
