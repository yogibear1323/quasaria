//! # Quasaria swap router
//!
//! Chains swaps across one or more Quasaria AMM pools:
//! * hop 0 pulls `amount_in` from the user (`pool.swap`),
//! * each intermediate output is sent **directly to the next pool**, which
//!   then runs `swap_prepaid` — the router never custodies funds,
//! * the final output goes to the user and is checked against `min_out`,
//! * a `deadline` (ledger timestamp) protects against stale transactions.
//!
//! Referral fee shares are handled inside each pool using the trader address.
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, panic_with_error, Address, Env, Vec,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria swap router");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RouterError {
    EmptyPath = 1,
    Expired = 2,
    Slippage = 3,
    TokenNotInPool = 4,
    PathTooLong = 5,
}

pub const MAX_HOPS: u32 = 4;

#[contractclient(name = "PoolClient")]
pub trait PoolInterface {
    fn tokens(env: Env) -> (Address, Address);
    fn get_amount_out(env: Env, token_in: Address, amount_in: i128) -> i128;
    fn swap(
        env: Env,
        sender: Address,
        to: Address,
        token_in: Address,
        amount_in: i128,
        min_out: i128,
    ) -> i128;
    fn swap_prepaid(env: Env, trader: Address, to: Address, token_in: Address, min_out: i128)
        -> i128;
}

#[contract]
pub struct Router;

fn other_token(env: &Env, pool: &Address, token_in: &Address) -> Address {
    let (a, b) = PoolClient::new(env, pool).tokens();
    if *token_in == a {
        b
    } else if *token_in == b {
        a
    } else {
        panic_with_error!(env, RouterError::TokenNotInPool)
    }
}

#[contractimpl]
impl Router {
    /// Quote each hop's output. Returns amounts including the input:
    /// `[amount_in, out_hop0, out_hop1, ...]`.
    pub fn get_amounts_out(env: Env, pools: Vec<Address>, token_in: Address, amount_in: i128) -> Vec<i128> {
        if pools.is_empty() {
            panic_with_error!(&env, RouterError::EmptyPath);
        }
        let mut amounts = Vec::new(&env);
        amounts.push_back(amount_in);
        let mut tok = token_in;
        let mut amt = amount_in;
        for pool in pools.iter() {
            let next = other_token(&env, &pool, &tok);
            amt = PoolClient::new(&env, &pool).get_amount_out(&tok, &amt);
            amounts.push_back(amt);
            tok = next;
        }
        amounts
    }

    /// Exact-input multi-hop swap.
    pub fn swap_exact_in(
        env: Env,
        user: Address,
        pools: Vec<Address>,
        token_in: Address,
        amount_in: i128,
        min_out: i128,
        deadline: u64,
    ) -> i128 {
        user.require_auth();
        let n = pools.len();
        if n == 0 {
            panic_with_error!(&env, RouterError::EmptyPath);
        }
        if n > MAX_HOPS {
            panic_with_error!(&env, RouterError::PathTooLong);
        }
        if env.ledger().timestamp() > deadline {
            panic_with_error!(&env, RouterError::Expired);
        }
        let mut tok = token_in;
        let mut out = 0i128;
        for i in 0..n {
            let pool = pools.get_unchecked(i);
            let next_tok = other_token(&env, &pool, &tok);
            // `i < n <= MAX_HOPS`, so `i + 1` cannot overflow.
            let next = i.saturating_add(1);
            let recipient = if next < n {
                pools.get_unchecked(next)
            } else {
                user.clone()
            };
            let pc = PoolClient::new(&env, &pool);
            out = if i == 0 {
                pc.swap(&user, &recipient, &tok, &amount_in, &0)
            } else {
                pc.swap_prepaid(&user, &recipient, &tok, &0)
            };
            tok = next_tok;
        }
        if out < min_out {
            panic_with_error!(&env, RouterError::Slippage);
        }
        out
    }
}

#[cfg(test)]
mod test;
