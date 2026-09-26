//! # Quasaria constant-product AMM pool
//!
//! * `x * y = k` pricing between two SEP-41 tokens (Stellar Asset Contracts
//!   for classic assets, or any Soroban token such as QFX).
//! * LP positions are **SEP-41 LP share tokens** implemented by the pool
//!   contract itself (`name = "Quasaria LP"`, `symbol = "QLP"`).
//! * A swap fee (`fee_bps`, max 1%) is charged on the input amount. The fee
//!   stays in the reserves, so it accrues to LPs pro-rata through their share
//!   of the pool — except the referral cut: if the trader has a referrer in
//!   the referral registry, `registry.share_bps` of the fee is paid to the
//!   referrer and recorded on-chain.
//! * `swap_prepaid` lets the router chain multi-hop swaps Uniswap-v2 style
//!   (tokens are sent straight to the next pool, no router custody).
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, Env, MuxedAddress, String,
};

pub const MAX_FEE_BPS: u32 = 100;
pub const MINIMUM_LIQUIDITY: i128 = 1_000;
const BPS: i128 = 10_000;
const DAY_LEDGERS: u32 = 17_280;

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

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
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

// --------------------------------------------------------------- helpers

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

fn mul_div(a: i128, b: i128, c: i128) -> i128 {
    match a.checked_mul(b) {
        Some(p) => p / c,
        None => (a / c) * b + (a % c) * b / c,
    }
}

/// Constant-product output for `amount_in` after fee.
pub fn amount_out(amount_in: i128, reserve_in: i128, reserve_out: i128, fee_bps: u32) -> i128 {
    let fee = fee_for(amount_in, fee_bps);
    let net = amount_in - fee;
    mul_div(net, reserve_out, reserve_in + net)
}

/// Fee is rounded up so tiny swaps cannot dodge it.
pub fn fee_for(amount_in: i128, fee_bps: u32) -> i128 {
    let num = amount_in * fee_bps as i128;
    (num + BPS - 1) / BPS
}

fn inst_i128(env: &Env, k: &DataKey) -> i128 {
    env.storage().instance().get(k).unwrap_or(0)
}

fn inst_addr(env: &Env, k: &DataKey) -> Address {
    env.storage().instance().get(k).unwrap()
}

fn bump(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(7 * DAY_LEDGERS, 30 * DAY_LEDGERS);
}

fn lp_of(env: &Env, id: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Lp(id.clone()))
        .unwrap_or(0)
}

fn set_lp(env: &Env, id: &Address, v: i128) {
    let k = DataKey::Lp(id.clone());
    env.storage().persistent().set(&k, &v);
    env.storage()
        .persistent()
        .extend_ttl(&k, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
}

fn mint_lp(env: &Env, to: &Address, shares: i128) {
    set_lp(env, to, lp_of(env, to) + shares);
    let t = inst_i128(env, &DataKey::TotalShares);
    env.storage()
        .instance()
        .set(&DataKey::TotalShares, &(t + shares));
}

fn burn_lp(env: &Env, from: &Address, shares: i128) {
    let bal = lp_of(env, from);
    if bal < shares {
        panic_with_error!(env, PoolError::InsufficientBalance);
    }
    set_lp(env, from, bal - shares);
    let t = inst_i128(env, &DataKey::TotalShares);
    env.storage()
        .instance()
        .set(&DataKey::TotalShares, &(t - shares));
}

fn move_lp(env: &Env, from: &Address, to: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(env, PoolError::NegativeAmount);
    }
    let bal = lp_of(env, from);
    if bal < amount {
        panic_with_error!(env, PoolError::InsufficientBalance);
    }
    set_lp(env, from, bal - amount);
    set_lp(env, to, lp_of(env, to) + amount);
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
    let a = read_allowance(env, from, spender);
    if a.amount < amount {
        panic_with_error!(env, PoolError::InsufficientAllowance);
    }
    env.storage().temporary().set(
        &DataKey::Allowance(from.clone(), spender.clone()),
        &AllowanceValue {
            amount: a.amount - amount,
            live_until_ledger: a.live_until_ledger,
        },
    );
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
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap();
        let fee = fee_for(amount_in, fee_bps);
        let out = amount_out(amount_in, r_in, r_out, fee_bps);
        if out < min_out || out <= 0 {
            panic_with_error!(env, PoolError::Slippage);
        }
        if out >= r_out {
            panic_with_error!(env, PoolError::InsufficientLiquidity);
        }

        // Referral cut of the fee (paid in the input token).
        let mut referral_fee = 0i128;
        if let Some(reg) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Referral)
        {
            let rc = ReferralClient::new(env, &reg);
            if let Some(referrer) = rc.get_referrer(trader) {
                referral_fee = fee * rc.share_bps() as i128 / BPS;
                if referral_fee > 0 {
                    let me = env.current_contract_address();
                    token::Client::new(env, token_in).transfer(&me, &referrer, &referral_fee);
                    rc.record_reward(&me, &referrer, token_in, &referral_fee);
                }
            }
        }

        let new_in = r_in + amount_in - referral_fee;
        let new_out = r_out - out;
        let (ra, rb, token_out) = if is_a {
            (new_in, new_out, inst_addr(env, &DataKey::TokenB))
        } else {
            (new_out, new_in, inst_addr(env, &DataKey::TokenA))
        };
        env.storage().instance().set(&DataKey::ReserveA, &ra);
        env.storage().instance().set(&DataKey::ReserveB, &rb);
        token::Client::new(env, &token_out).transfer(&env.current_contract_address(), to, &out);
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

#[contractimpl]
impl AmmPool {
    pub fn __constructor(
        env: Env,
        admin: Address,
        token_a: Address,
        token_b: Address,
        fee_bps: u32,
        referral: Option<Address>,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, PoolError::FeeTooHigh);
        }
        if token_a == token_b {
            panic_with_error!(&env, PoolError::SameToken);
        }
        let st = env.storage().instance();
        st.set(&DataKey::Admin, &admin);
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

    pub fn set_fee_bps(env: Env, fee_bps: u32) {
        inst_addr(&env, &DataKey::Admin).require_auth();
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, PoolError::FeeTooHigh);
        }
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    }

    pub fn set_referral(env: Env, referral: Option<Address>) {
        inst_addr(&env, &DataKey::Admin).require_auth();
        match referral {
            Some(r) => env.storage().instance().set(&DataKey::Referral, &r),
            None => env.storage().instance().remove(&DataKey::Referral),
        }
    }

    pub fn tokens(env: Env) -> (Address, Address) {
        (
            inst_addr(&env, &DataKey::TokenA),
            inst_addr(&env, &DataKey::TokenB),
        )
    }

    pub fn reserves(env: Env) -> (i128, i128) {
        (
            inst_i128(&env, &DataKey::ReserveA),
            inst_i128(&env, &DataKey::ReserveB),
        )
    }

    pub fn info(env: Env) -> PoolInfo {
        PoolInfo {
            token_a: inst_addr(&env, &DataKey::TokenA),
            token_b: inst_addr(&env, &DataKey::TokenB),
            reserve_a: inst_i128(&env, &DataKey::ReserveA),
            reserve_b: inst_i128(&env, &DataKey::ReserveB),
            total_shares: inst_i128(&env, &DataKey::TotalShares),
            fee_bps: env.storage().instance().get(&DataKey::FeeBps).unwrap(),
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
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap();
        amount_out(amount_in, r_in, r_out, fee_bps)
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
        if desired_a <= 0 || desired_b <= 0 {
            panic_with_error!(&env, PoolError::ZeroAmount);
        }
        let ra = inst_i128(&env, &DataKey::ReserveA);
        let rb = inst_i128(&env, &DataKey::ReserveB);
        let total = inst_i128(&env, &DataKey::TotalShares);
        let me = env.current_contract_address();

        let (amt_a, amt_b, shares) = if total == 0 {
            let s = sqrt(desired_a * desired_b);
            if s <= MINIMUM_LIQUIDITY {
                panic_with_error!(&env, PoolError::InsufficientLiquidity);
            }
            // Lock MINIMUM_LIQUIDITY forever (owned by the pool) to prevent
            // share-price inflation attacks.
            mint_lp(&env, &me, MINIMUM_LIQUIDITY);
            (desired_a, desired_b, s - MINIMUM_LIQUIDITY)
        } else {
            let b_opt = mul_div(desired_a, rb, ra);
            let (a, b) = if b_opt <= desired_b {
                if b_opt < min_b {
                    panic_with_error!(&env, PoolError::Slippage);
                }
                (desired_a, b_opt)
            } else {
                let a_opt = mul_div(desired_b, ra, rb);
                if a_opt < min_a || a_opt > desired_a {
                    panic_with_error!(&env, PoolError::Slippage);
                }
                (a_opt, desired_b)
            };
            let sa = mul_div(a, total, ra);
            let sb = mul_div(b, total, rb);
            (a, b, if sa < sb { sa } else { sb })
        };
        if amt_a < min_a || amt_b < min_b || shares <= 0 {
            panic_with_error!(&env, PoolError::Slippage);
        }
        token::Client::new(&env, &inst_addr(&env, &DataKey::TokenA)).transfer(&to, &me, &amt_a);
        token::Client::new(&env, &inst_addr(&env, &DataKey::TokenB)).transfer(&to, &me, &amt_b);
        env.storage().instance().set(&DataKey::ReserveA, &(ra + amt_a));
        env.storage().instance().set(&DataKey::ReserveB, &(rb + amt_b));
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
    pub fn withdraw(env: Env, to: Address, shares: i128, min_a: i128, min_b: i128) -> (i128, i128) {
        to.require_auth();
        if shares <= 0 {
            panic_with_error!(&env, PoolError::ZeroAmount);
        }
        let ra = inst_i128(&env, &DataKey::ReserveA);
        let rb = inst_i128(&env, &DataKey::ReserveB);
        let total = inst_i128(&env, &DataKey::TotalShares);
        let a = mul_div(shares, ra, total);
        let b = mul_div(shares, rb, total);
        if a < min_a || b < min_b {
            panic_with_error!(&env, PoolError::Slippage);
        }
        burn_lp(&env, &to, shares);
        env.storage().instance().set(&DataKey::ReserveA, &(ra - a));
        env.storage().instance().set(&DataKey::ReserveB, &(rb - b));
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
        Self::orient(&env, &token_in);
        token::Client::new(&env, &token_in).transfer(
            &sender,
            &env.current_contract_address(),
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
        let (_, r_in, _) = Self::orient(&env, &token_in);
        let bal = token::Client::new(&env, &token_in).balance(&env.current_contract_address());
        let amount_in = bal - r_in;
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
        let k = DataKey::Allowance(from, spender);
        env.storage().temporary().set(
            &k,
            &AllowanceValue {
                amount,
                live_until_ledger,
            },
        );
        if amount > 0 {
            let live_for = live_until_ledger - env.ledger().sequence();
            env.storage().temporary().extend_ttl(&k, live_for, live_for);
        }
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
