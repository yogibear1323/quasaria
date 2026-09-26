//! # Quasaria Referral Registry
//!
//! On-chain referral graph used by the Quasaria AMM pools and leverage vault.
//!
//! Rules enforced on-chain:
//! * a user may set their referrer **exactly once**;
//! * self-referral is rejected;
//! * cycles are rejected (the new referrer's ancestor chain must not contain
//!   the user, checked up to `MAX_DEPTH` hops);
//! * only admin-approved "fee sources" (pools, vault) can record referral
//!   earnings, so the dashboard stats cannot be spoofed.
//!
//! The registry never custodies funds: fee sources pay the referrer directly
//! and then call [`ReferralRegistry::record_reward`] for bookkeeping.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env,
};

/// Maximum number of ancestor hops inspected for cycle detection.
pub const MAX_DEPTH: u32 = 32;
/// Hard cap for the referral share of fees (50%).
pub const MAX_SHARE_BPS: u32 = 5_000;

const DAY_LEDGERS: u32 = 17_280;
const BUMP_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const BUMP_TO: u32 = 120 * DAY_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReferralError {
    AlreadySet = 1,
    SelfReferral = 2,
    Cycle = 3,
    NotFeeSource = 4,
    ShareTooHigh = 5,
    NegativeAmount = 6,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    ShareBps,
    Referrer(Address),
    Count(Address),
    Earned(Address, Address), // (referrer, token)
    FeeSource(Address),
}

#[contractevent(topics = ["referral_set"])]
pub struct ReferrerSet {
    #[topic]
    pub user: Address,
    #[topic]
    pub referrer: Address,
}

#[contractevent(topics = ["referral_paid"])]
pub struct ReferralPaid {
    #[topic]
    pub referrer: Address,
    pub token: Address,
    pub amount: i128,
    pub source: Address,
}

#[contract]
pub struct ReferralRegistry;

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_TO);
}

#[contractimpl]
impl ReferralRegistry {
    /// `share_bps`: portion of each swap/trading fee routed to the referrer.
    pub fn __constructor(env: Env, admin: Address, share_bps: u32) {
        if share_bps > MAX_SHARE_BPS {
            panic_with_error!(&env, ReferralError::ShareTooHigh);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ShareBps, &share_bps);
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Referral share of fees, in basis points of the fee.
    pub fn share_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::ShareBps).unwrap_or(0)
    }

    pub fn set_share_bps(env: Env, share_bps: u32) {
        Self::admin(env.clone()).require_auth();
        if share_bps > MAX_SHARE_BPS {
            panic_with_error!(&env, ReferralError::ShareTooHigh);
        }
        env.storage().instance().set(&DataKey::ShareBps, &share_bps);
    }

    /// Admin approves a contract (pool / vault) allowed to record earnings.
    pub fn set_fee_source(env: Env, source: Address, allowed: bool) {
        Self::admin(env.clone()).require_auth();
        let key = DataKey::FeeSource(source);
        if allowed {
            env.storage().persistent().set(&key, &true);
            bump(&env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
    }

    pub fn is_fee_source(env: Env, source: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::FeeSource(source))
            .unwrap_or(false)
    }

    /// Set the caller's referrer. Can only be done once.
    pub fn set_referrer(env: Env, user: Address, referrer: Address) {
        user.require_auth();
        if user == referrer {
            panic_with_error!(&env, ReferralError::SelfReferral);
        }
        let key = DataKey::Referrer(user.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, ReferralError::AlreadySet);
        }
        // Walk up the referrer's ancestors: if we meet `user`, this would
        // close a loop. Depth is bounded to keep the cost predictable; chains
        // deeper than MAX_DEPTH are rejected conservatively.
        let mut cursor = referrer.clone();
        let mut depth = 0u32;
        loop {
            match env
                .storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::Referrer(cursor.clone()))
            {
                None => break,
                Some(parent) => {
                    if parent == user {
                        panic_with_error!(&env, ReferralError::Cycle);
                    }
                    depth += 1;
                    if depth >= MAX_DEPTH {
                        panic_with_error!(&env, ReferralError::Cycle);
                    }
                    cursor = parent;
                }
            }
        }
        env.storage().persistent().set(&key, &referrer);
        bump(&env, &key);
        let ckey = DataKey::Count(referrer.clone());
        let count: u32 = env.storage().persistent().get(&ckey).unwrap_or(0);
        env.storage().persistent().set(&ckey, &(count + 1));
        bump(&env, &ckey);
        ReferrerSet { user, referrer }.publish(&env);
    }

    pub fn get_referrer(env: Env, user: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Referrer(user))
    }

    pub fn referral_count(env: Env, referrer: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Count(referrer))
            .unwrap_or(0)
    }

    pub fn earned(env: Env, referrer: Address, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Earned(referrer, token))
            .unwrap_or(0)
    }

    /// Bookkeeping hook called by approved fee sources after they have paid
    /// `amount` of `token` to `referrer`.
    pub fn record_reward(env: Env, source: Address, referrer: Address, token: Address, amount: i128) {
        source.require_auth();
        if !Self::is_fee_source(env.clone(), source.clone()) {
            panic_with_error!(&env, ReferralError::NotFeeSource);
        }
        if amount < 0 {
            panic_with_error!(&env, ReferralError::NegativeAmount);
        }
        let key = DataKey::Earned(referrer.clone(), token.clone());
        let cur: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(cur + amount));
        bump(&env, &key);
        ReferralPaid {
            referrer,
            token,
            amount,
            source,
        }
        .publish(&env);
    }
}

#[cfg(test)]
mod test;
