//! # Quasaria constant-product AMM pool
//!
//! * `x * y = k` pricing between two SEP-41 tokens (Stellar Asset Contracts
//!   for classic assets, or any Soroban token such as QFX).
//! * LP positions are **SEP-41 LP share tokens** implemented by the pool
//!   contract itself (`name = "Quasaria LP"`, `symbol = "QLP"`), emitting the
//!   standard `transfer` / `approve` / `mint` / `burn` events.
//! * A swap fee (`fee_bps`, max 1%) is charged on the input amount. The fee
//!   stays in the reserves, so it accrues to LPs pro-rata through their share
//!   of the pool — except the referral cut: if the trader has a referrer in
//!   the referral registry, `registry.share_bps` of the fee is paid to the
//!   referrer and recorded on-chain.
//! * **Referral hook is bounded (F-05):** the pool re-caps the registry's
//!   share at [`MAX_REFERRAL_SHARE_BPS`] (50% of the fee), so a registry can
//!   never move more than half of the fee of the current swap — never pool
//!   reserves. All registry calls are `try_` calls: a broken or hostile
//!   registry cannot brick swaps. Reserves are written before any external
//!   payout (checks-effects-interactions).
//! * `swap_prepaid` lets the router chain multi-hop swaps Uniswap-v2 style
//!   (tokens are sent straight to the next pool, no router custody).
//! * Governance: two-step admin transfer, guardian pause (blocks swaps and
//!   deposits; `withdraw` and LP transfers always work), timelocked
//!   `SetFeeBps` / `SetReferral` / `Upgrade` / `SetDelay`.
#![no_std]

use quasaria_gov as gov;
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, MuxedAddress, String,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria AMM pool");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

pub const MAX_FEE_BPS: u32 = 100;
pub const MINIMUM_LIQUIDITY: i128 = 1_000;
/// Hard cap on the part of a swap fee the referral hook may pay out (50%).
pub const MAX_REFERRAL_SHARE_BPS: u32 = 5_000;
const BPS: i128 = 10_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    FeeTooHigh = 1,
    SameToken = 2,
    InvalidToken = 3,
    ZeroAmount = 4,
    Slippage = 5,
    InsufficientLiquidity = 6,
    InsufficientBalance = 7,
    InsufficientAllowance = 8,
    NegativeAmount = 9,
    InvalidExpiration = 10,
}

/// Minimal client for the referral registry (see `quasaria-referral`).
#[contractclient(name = "ReferralClient")]
pub trait ReferralInterface {
    fn get_referrer(env: Env, user: Address) -> Option<Address>;
    fn share_bps(env: Env) -> u32;
    fn record_reward(env: Env, source: Address, referrer: Address, token: Address, amount: i128);
}

/// Timelocked admin actions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PoolAction {
    SetFeeBps(u32),
    SetReferral(Option<Address>),
    Upgrade(BytesN<32>),
    SetDelay(u64),
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    FeeBps,
    Referral,
    TotalShares,
    Lp(Address),
    Allowance(Address, Address),
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolInfo {
    pub token_a: Address,
    pub token_b: Address,
    pub reserve_a: i128,
    pub reserve_b: i128,
    pub total_shares: i128,
    pub fee_bps: u32,
}

#[contractevent(topics = ["swap"])]
pub struct Swap {
    #[topic]
    pub trader: Address,
    pub token_in: Address,
    pub amount_in: i128,
    pub amount_out: i128,
    pub fee: i128,
    pub referral_fee: i128,
}

#[contractevent(topics = ["deposit"])]
pub struct Deposit {
    #[topic]
    pub to: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
}

#[contractevent(topics = ["withdraw"])]
pub struct Withdraw {
    #[topic]
    pub to: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
}

#[contractevent(topics = ["transfer"], data_format = "single-value")]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// SEP-41 `approve` event: topics `["approve", from, spender]`,
/// data `[amount, live_until_ledger]`.
#[contractevent(topics = ["approve"], data_format = "vec")]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub live_until_ledger: u32,
}

/// SEP-41 `burn` event: topics `["burn", from]`, data `amount`.
#[contractevent(topics = ["burn"], data_format = "single-value")]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// SEP-41 `mint` event: topics `["mint", to]`, data `amount`.
#[contractevent(topics = ["mint"], data_format = "single-value")]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["fee_set"], data_format = "single-value")]
pub struct FeeSet {
    pub fee_bps: u32,
}

#[contractevent(topics = ["referral_hook_set"], data_format = "single-value")]
pub struct ReferralHookSet {
    pub referral: Option<Address>,
}

// --------------------------------------------------------------- helpers

/// Babylonian integer square root. For `y >= 4`, `y / 2 + 1 <= y` and
/// `y / x + x <= y` for every iterate, so nothing here can overflow.
#[allow(clippy::arithmetic_side_effects, clippy::integer_division)]
pub fn sqrt(y: i128) -> i128 {
    if y < 4 {
        return if y == 0 { 0 } else { 1 };
    }
    let mut z = y;
    let mut x = y / 2 + 1;
    while x < z {
        z = x;
        x = (y / x + x) / 2;
    }
    z
}

/// Constant-product output for `amount_in` after fee (checked, 256-bit safe).
pub fn amount_out(
    env: &Env,
    amount_in: i128,
    reserve_in: i128,
    reserve_out: i128,
    fee_bps: u32,
) -> i128 {
    let fee = fee_for(env, amount_in, fee_bps);
    let net = gov::sub(env, amount_in, fee);
    gov::mul_div_floor(env, net, reserve_out, gov::add(env, reserve_in, net))
}

/// Fee is rounded up so tiny swaps cannot dodge it.
pub fn fee_for(env: &Env, amount_in: i128, fee_bps: u32) -> i128 {
    gov::mul_div_ceil(env, amount_in, i128::from(fee_bps), BPS)
}

fn inst_i128(env: &Env, k: &DataKey) -> i128 {
    env.storage().instance().get(k).unwrap_or(0)
}

fn inst_addr(env: &Env, k: &DataKey) -> Address {
    env.storage()
        .instance()
        .get(k)
        .unwrap_or_else(|| panic_with_error!(env, PoolError::InvalidToken))
}

fn fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
}

fn bump(env: &Env) {
    gov::bump_instance(env);
}

fn lp_of(env: &Env, id: &Address) -> i128 {
    let k = DataKey::Lp(id.clone());
    match env.storage().persistent().get::<DataKey, i128>(&k) {
        Some(v) => {
            gov::bump_persistent(env, &k);
            v
        }
        None => 0,
    }
}

fn set_lp(env: &Env, id: &Address, v: i128) {
    let k = DataKey::Lp(id.clone());
    env.storage().persistent().set(&k, &v);
    gov::bump_persistent(env, &k);
}

fn mint_lp(env: &Env, to: &Address, shares: i128) {
    set_lp(env, to, gov::add(env, lp_of(env, to), shares));
    let t = inst_i128(env, &DataKey::TotalShares);
    env.storage()
        .instance()
        .set(&DataKey::TotalShares, &gov::add(env, t, shares));
    Mint {
        to: to.clone(),
        amount: shares,
    }
    .publish(env);
}

fn burn_lp(env: &Env, from: &Address, shares: i128) {
    if shares < 0 {
        panic_with_error!(env, PoolError::NegativeAmount);
    }
    let bal = lp_of(env, from);
    if bal < shares {
        panic_with_error!(env, PoolError::InsufficientBalance);
    }
    set_lp(env, from, gov::sub(env, bal, shares));
    let t = inst_i128(env, &DataKey::TotalShares);
    env.storage()
        .instance()
        .set(&DataKey::TotalShares, &gov::sub(env, t, shares));
    Burn {
        from: from.clone(),
        amount: shares,
    }
    .publish(env);
}

fn move_lp(env: &Env, from: &Address, to: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(env, PoolError::NegativeAmount);
    }
    let bal = lp_of(env, from);
    if bal < amount {
        panic_with_error!(env, PoolError::InsufficientBalance);
    }
    set_lp(env, from, gov::sub(env, bal, amount));
    set_lp(env, to, gov::add(env, lp_of(env, to), amount));
}

fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    match env
        .storage()
        .temporary()
        .get::<DataKey, AllowanceValue>(&DataKey::Allowance(from.clone(), spender.clone()))
    {
        Some(a) if a.live_until_ledger >= env.ledger().sequence() => a,
        _ => AllowanceValue {
            amount: 0,
            live_until_ledger: 0,
        },
    }
}

fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(env, PoolError::NegativeAmount);
    }
    let a = read_allowance(env, from, spender);
    if a.amount < amount {
        panic_with_error!(env, PoolError::InsufficientAllowance);
    }
    env.storage().temporary().set(
        &DataKey::Allowance(from.clone(), spender.clone()),
        &AllowanceValue {
            amount: gov::sub(env, a.amount, amount),
            live_until_ledger: a.live_until_ledger,
        },
    );
}

/// Bounded referral cut for `trader` on a swap paying `fee`. Never more than
/// `MAX_REFERRAL_SHARE_BPS` of the fee; any registry failure means no cut.
fn referral_cut(env: &Env, trader: &Address, fee: i128) -> Option<(Address, Address, i128)> {
    let reg: Address = env.storage().instance().get(&DataKey::Referral)?;
    let rc = ReferralClient::new(env, &reg);
    let referrer = match rc.try_get_referrer(trader) {
        Ok(Ok(Some(r))) => r,
        _ => return None,
    };
    if referrer == env.current_contract_address() {
        return None;
    }
    let share = match rc.try_share_bps() {
        Ok(Ok(s)) => s.min(MAX_REFERRAL_SHARE_BPS),
        _ => return None,
    };
    let cut = gov::mul_div_floor(env, fee, i128::from(share), BPS);
    if cut <= 0 {
        return None;
    }
    Some((reg, referrer, cut))
}

#[contract]
pub struct AmmPool;

impl AmmPool {
    /// Returns (is_a, reserve_in, reserve_out).
    fn orient(env: &Env, token_in: &Address) -> (bool, i128, i128) {
        let a = inst_addr(env, &DataKey::TokenA);
        let b = inst_addr(env, &DataKey::TokenB);
        let ra = inst_i128(env, &DataKey::ReserveA);
        let rb = inst_i128(env, &DataKey::ReserveB);
        if *token_in == a {
            (true, ra, rb)
        } else if *token_in == b {
            (false, rb, ra)
        } else {
            panic_with_error!(env, PoolError::InvalidToken)
        }
    }

    fn write_reserves(env: &Env, is_a: bool, r_in: i128, r_out: i128) {
        let (ra, rb) = if is_a { (r_in, r_out) } else { (r_out, r_in) };
        env.storage().instance().set(&DataKey::ReserveA, &ra);
        env.storage().instance().set(&DataKey::ReserveB, &rb);
    }

    fn do_swap(
        env: &Env,
        trader: &Address,
        to: &Address,
        token_in: &Address,
        amount_in: i128,
        min_out: i128,
    ) -> i128 {
        if amount_in <= 0 {
            panic_with_error!(env, PoolError::ZeroAmount);
        }
        let (is_a, r_in, r_out) = Self::orient(env, token_in);
        if r_in == 0 || r_out == 0 {
            panic_with_error!(env, PoolError::InsufficientLiquidity);
        }
        let fee_bps = fee_bps(env);
        let fee = fee_for(env, amount_in, fee_bps);
        let out = amount_out(env, amount_in, r_in, r_out, fee_bps);
        if out < min_out || out <= 0 {
            panic_with_error!(env, PoolError::Slippage);
        }
        if out >= r_out {
            panic_with_error!(env, PoolError::InsufficientLiquidity);
        }

        // Referral cut of the fee (paid in the input token), bounded.
        let cut = referral_cut(env, trader, fee);
        let mut referral_fee = cut.as_ref().map(|c| c.2).unwrap_or(0);

        // Effects first: reserves assume the referral payout succeeds.
        let new_in = gov::sub(env, gov::add(env, r_in, amount_in), referral_fee);
        let new_out = gov::sub(env, r_out, out);
        Self::write_reserves(env, is_a, new_in, new_out);
        let token_out = if is_a {
            inst_addr(env, &DataKey::TokenB)
        } else {
            inst_addr(env, &DataKey::TokenA)
        };
        let me = env.current_contract_address();

        // Interactions.
        if let Some((reg, referrer, amt)) = cut {
            let paid = token::Client::new(env, token_in)
                .try_transfer(&me, &referrer, &amt)
                .is_ok();
            if paid {
                // bookkeeping only; a failing registry must not break swaps
                let _ = ReferralClient::new(env, &reg).try_record_reward(
                    &me, &referrer, token_in, &amt,
                );
            } else {
                // referrer cannot receive (e.g. no trustline): fee stays with LPs
                referral_fee = 0;
                Self::write_reserves(env, is_a, gov::add(env, new_in, amt), new_out);
            }
        }
        token::Client::new(env, &token_out).transfer(&me, to, &out);
        bump(env);
        Swap {
            trader: trader.clone(),
            token_in: token_in.clone(),
            amount_in,
            amount_out: out,
            fee,
            referral_fee,
        }
        .publish(env);
        out
    }
}

quasaria_gov::governance_entrypoints!(AmmPool, PoolAction);
quasaria_gov::pause_entrypoints!(AmmPool);

#[contractimpl]
impl AmmPool {
    pub fn __constructor(
        env: Env,
        admin: Address,
        token_a: Address,
        token_b: Address,
        fee_bps: u32,
        referral: Option<Address>,
        timelock_delay: u64,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, PoolError::FeeTooHigh);
        }
        if token_a == token_b {
            panic_with_error!(&env, PoolError::SameToken);
        }
        gov::init(&env, &admin, timelock_delay);
        let st = env.storage().instance();
        st.set(&DataKey::TokenA, &token_a);
        st.set(&DataKey::TokenB, &token_b);
        st.set(&DataKey::FeeBps, &fee_bps);
        st.set(&DataKey::ReserveA, &0i128);
        st.set(&DataKey::ReserveB, &0i128);
        st.set(&DataKey::TotalShares, &0i128);
        if let Some(r) = referral {
            st.set(&DataKey::Referral, &r);
        }
    }

    /// Apply a queued timelocked action after its delay.
    pub fn execute_action(env: Env, action: PoolAction) {
        gov::consume(&env, &action);
        match action {
            PoolAction::SetFeeBps(fee_bps) => {
                if fee_bps > MAX_FEE_BPS {
                    panic_with_error!(&env, PoolError::FeeTooHigh);
                }
                env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
                FeeSet { fee_bps }.publish(&env);
            }
            PoolAction::SetReferral(referral) => {
                match &referral {
                    Some(r) => env.storage().instance().set(&DataKey::Referral, r),
                    None => env.storage().instance().remove(&DataKey::Referral),
                }
                ReferralHookSet { referral }.publish(&env);
            }
            PoolAction::Upgrade(hash) => gov::upgrade_now(&env, &hash),
            PoolAction::SetDelay(d) => gov::set_delay_now(&env, d),
        }
    }

    pub fn referral(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Referral)
    }

    pub fn tokens(env: Env) -> (Address, Address) {
        bump(&env);
        (
            inst_addr(&env, &DataKey::TokenA),
            inst_addr(&env, &DataKey::TokenB),
        )
    }

    pub fn reserves(env: Env) -> (i128, i128) {
        bump(&env);
        (
            inst_i128(&env, &DataKey::ReserveA),
            inst_i128(&env, &DataKey::ReserveB),
        )
    }

    pub fn info(env: Env) -> PoolInfo {
        bump(&env);
        PoolInfo {
            token_a: inst_addr(&env, &DataKey::TokenA),
            token_b: inst_addr(&env, &DataKey::TokenB),
            reserve_a: inst_i128(&env, &DataKey::ReserveA),
            reserve_b: inst_i128(&env, &DataKey::ReserveB),
            total_shares: inst_i128(&env, &DataKey::TotalShares),
            fee_bps: fee_bps(&env),
        }
    }

    pub fn total_shares(env: Env) -> i128 {
        inst_i128(&env, &DataKey::TotalShares)
    }

    /// Quote the output of a swap (fee included).
    pub fn get_amount_out(env: Env, token_in: Address, amount_in: i128) -> i128 {
        let (_, r_in, r_out) = Self::orient(&env, &token_in);
        if r_in == 0 || r_out == 0 || amount_in <= 0 {
            return 0;
        }
        amount_out(&env, amount_in, r_in, r_out, fee_bps(&env))
    }

    /// Add liquidity. Returns (amount_a, amount_b, shares_minted).
    pub fn deposit(
        env: Env,
        to: Address,
        desired_a: i128,
        desired_b: i128,
        min_a: i128,
        min_b: i128,
    ) -> (i128, i128, i128) {
        to.require_auth();
        gov::when_not_paused(&env);
        if desired_a <= 0 || desired_b <= 0 {
            panic_with_error!(&env, PoolError::ZeroAmount);
        }
        let ra = inst_i128(&env, &DataKey::ReserveA);
        let rb = inst_i128(&env, &DataKey::ReserveB);
        let total = inst_i128(&env, &DataKey::TotalShares);
        let me = env.current_contract_address();

        let (amt_a, amt_b, shares) = if total == 0 {
            let s = sqrt(gov::mul(&env, desired_a, desired_b));
            if s <= MINIMUM_LIQUIDITY {
                panic_with_error!(&env, PoolError::InsufficientLiquidity);
            }
            // Lock MINIMUM_LIQUIDITY forever (owned by the pool) to prevent
            // share-price inflation attacks.
            mint_lp(&env, &me, MINIMUM_LIQUIDITY);
            (desired_a, desired_b, gov::sub(&env, s, MINIMUM_LIQUIDITY))
        } else {
            let b_opt = gov::mul_div_floor(&env, desired_a, rb, ra);
            let (a, b) = if b_opt <= desired_b {
                if b_opt < min_b {
                    panic_with_error!(&env, PoolError::Slippage);
                }
                (desired_a, b_opt)
            } else {
                let a_opt = gov::mul_div_floor(&env, desired_b, ra, rb);
                if a_opt < min_a || a_opt > desired_a {
                    panic_with_error!(&env, PoolError::Slippage);
                }
                (a_opt, desired_b)
            };
            let sa = gov::mul_div_floor(&env, a, total, ra);
            let sb = gov::mul_div_floor(&env, b, total, rb);
            (a, b, sa.min(sb))
        };
        if amt_a < min_a || amt_b < min_b || shares <= 0 {
            panic_with_error!(&env, PoolError::Slippage);
        }
        token::Client::new(&env, &inst_addr(&env, &DataKey::TokenA)).transfer(&to, &me, &amt_a);
        token::Client::new(&env, &inst_addr(&env, &DataKey::TokenB)).transfer(&to, &me, &amt_b);
        env.storage()
            .instance()
            .set(&DataKey::ReserveA, &gov::add(&env, ra, amt_a));
        env.storage()
            .instance()
            .set(&DataKey::ReserveB, &gov::add(&env, rb, amt_b));
        mint_lp(&env, &to, shares);
        bump(&env);
        Deposit {
            to,
            amount_a: amt_a,
            amount_b: amt_b,
            shares,
        }
        .publish(&env);
        (amt_a, amt_b, shares)
    }

    /// Burn LP shares for the pro-rata reserves (incl. accrued fees).
    /// Never paused: LPs can always exit.
    pub fn withdraw(env: Env, to: Address, shares: i128, min_a: i128, min_b: i128) -> (i128, i128) {
        to.require_auth();
        if shares <= 0 {
            panic_with_error!(&env, PoolError::ZeroAmount);
        }
        let ra = inst_i128(&env, &DataKey::ReserveA);
        let rb = inst_i128(&env, &DataKey::ReserveB);
        let total = inst_i128(&env, &DataKey::TotalShares);
        if total <= 0 {
            panic_with_error!(&env, PoolError::InsufficientLiquidity);
        }
        let a = gov::mul_div_floor(&env, shares, ra, total);
        let b = gov::mul_div_floor(&env, shares, rb, total);
        if a < min_a || b < min_b {
            panic_with_error!(&env, PoolError::Slippage);
        }
        burn_lp(&env, &to, shares);
        env.storage()
            .instance()
            .set(&DataKey::ReserveA, &gov::sub(&env, ra, a));
        env.storage()
            .instance()
            .set(&DataKey::ReserveB, &gov::sub(&env, rb, b));
        let me = env.current_contract_address();
        token::Client::new(&env, &inst_addr(&env, &DataKey::TokenA)).transfer(&me, &to, &a);
        token::Client::new(&env, &inst_addr(&env, &DataKey::TokenB)).transfer(&me, &to, &b);
        bump(&env);
        Withdraw {
            to,
            amount_a: a,
            amount_b: b,
            shares,
        }
        .publish(&env);
        (a, b)
    }

    /// Swap `amount_in` of `token_in` pulled from `sender`; output to `to`.
    pub fn swap(
        env: Env,
        sender: Address,
        to: Address,
        token_in: Address,
        amount_in: i128,
        min_out: i128,
    ) -> i128 {
        sender.require_auth();
        gov::when_not_paused(&env);
        Self::orient(&env, &token_in);
        if amount_in <= 0 {
            panic_with_error!(&env, PoolError::ZeroAmount);
        }
        token::Client::new(&env, &token_in).transfer(
            &sender,
            env.current_contract_address(),
            &amount_in,
        );
        Self::do_swap(&env, &sender, &to, &token_in, amount_in, min_out)
    }

    /// Swap whatever surplus of `token_in` was sent to the pool before this
    /// call (used by the router for multi-hop). `trader` is used for referral
    /// attribution only.
    pub fn swap_prepaid(
        env: Env,
        trader: Address,
        to: Address,
        token_in: Address,
        min_out: i128,
    ) -> i128 {
        gov::when_not_paused(&env);
        let (_, r_in, _) = Self::orient(&env, &token_in);
        let bal = token::Client::new(&env, &token_in).balance(&env.current_contract_address());
        let amount_in = gov::sub(&env, bal, r_in);
        Self::do_swap(&env, &trader, &to, &token_in, amount_in, min_out)
    }

    /// Absorb surplus balances (e.g. QFX holder rewards earned by the pool's
    /// own reserves, or donations) into reserves — benefits LPs.
    pub fn sync(env: Env) {
        let me = env.current_contract_address();
        let a = token::Client::new(&env, &inst_addr(&env, &DataKey::TokenA)).balance(&me);
        let b = token::Client::new(&env, &inst_addr(&env, &DataKey::TokenB)).balance(&me);
        env.storage().instance().set(&DataKey::ReserveA, &a);
        env.storage().instance().set(&DataKey::ReserveB, &b);
        bump(&env);
    }
}

/// LP shares are a SEP-41 token.
#[contractimpl]
impl token::TokenInterface for AmmPool {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        read_allowance(&env, &from, &spender).amount
    }
    fn approve(env: Env, from: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic_with_error!(&env, PoolError::NegativeAmount);
        }
        if amount > 0 && live_until_ledger < env.ledger().sequence() {
            panic_with_error!(&env, PoolError::InvalidExpiration);
        }
        let k = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().temporary().set(
            &k,
            &AllowanceValue {
                amount,
                live_until_ledger,
            },
        );
        if amount > 0 {
            let live_for = live_until_ledger.saturating_sub(env.ledger().sequence());
            env.storage().temporary().extend_ttl(&k, live_for, live_for);
        }
        Approve {
            from,
            spender,
            amount,
            live_until_ledger,
        }
        .publish(&env);
    }
    fn balance(env: Env, id: Address) -> i128 {
        lp_of(&env, &id)
    }
    fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to = to.address();
        move_lp(&env, &from, &to, amount);
        Transfer { from, to, amount }.publish(&env);
    }
    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        spend_allowance(&env, &from, &spender, amount);
        move_lp(&env, &from, &to, amount);
        Transfer { from, to, amount }.publish(&env);
    }
    /// Burning LP without withdrawing donates the underlying to other LPs.
    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        burn_lp(&env, &from, amount);
    }
    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        spend_allowance(&env, &from, &spender, amount);
        burn_lp(&env, &from, amount);
    }
    fn decimals(_env: Env) -> u32 {
        7
    }
    fn name(env: Env) -> String {
        String::from_str(&env, "Quasaria LP")
    }
    fn symbol(env: Env) -> String {
        String::from_str(&env, "QLP")
    }
}

#[cfg(test)]
mod test;
