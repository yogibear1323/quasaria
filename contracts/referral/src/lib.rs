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
//! and then call [`ReferralRegistry::record_reward`] for bookkeeping. Fee
//! sources re-cap `share_bps` on their side, so a registry can never make a
//! pool pay out more than a bounded slice of the fee.
//!
//! Governance: two-step admin transfer, guardian pause (blocks
//! `set_referrer` only — `record_reward` keeps working so swaps never break),
//! timelocked `SetShareBps` / `Upgrade` / `SetDelay`. TTLs of the instance and
//! of every persistent entry are extended on read and write.
#![no_std]

use quasaria_gov as gov;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    BytesN, Env,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria referral registry");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

/// Maximum number of ancestor hops inspected for cycle detection.
pub const MAX_DEPTH: u32 = 32;
/// Hard cap for the referral share of fees (50%).
pub const MAX_SHARE_BPS: u32 = 5_000;


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

/// Timelocked admin actions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReferralAction {
    SetShareBps(u32),
    Upgrade(BytesN<32>),
    SetDelay(u64),
}

#[contractevent(topics = ["share_set"], data_format = "single-value")]
pub struct ShareSet {
    pub share_bps: u32,
}

#[contractevent(topics = ["fee_source_set"], data_format = "single-value")]
pub struct FeeSourceSet {
    #[topic]
    pub source: Address,
    pub allowed: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
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
    gov::bump_persistent(env, key);
}

fn check_share(env: &Env, share_bps: u32) {
    if share_bps > MAX_SHARE_BPS {
        panic_with_error!(env, ReferralError::ShareTooHigh);
    }
}

quasaria_gov::governance_entrypoints!(ReferralRegistry, ReferralAction);
quasaria_gov::pause_entrypoints!(ReferralRegistry);

#[contractimpl]
impl ReferralRegistry {
    /// `share_bps`: portion of each swap/trading fee routed to the referrer.
    pub fn __constructor(env: Env, admin: Address, share_bps: u32, timelock_delay: u64) {
        check_share(&env, share_bps);
        gov::init(&env, &admin, timelock_delay);
        env.storage().instance().set(&DataKey::ShareBps, &share_bps);
    }

    /// Apply a queued timelocked action after its delay.
    pub fn execute_action(env: Env, action: ReferralAction) {
        gov::consume(&env, &action);
        match action {
            ReferralAction::SetShareBps(share_bps) => {
                check_share(&env, share_bps);
                env.storage().instance().set(&DataKey::ShareBps, &share_bps);
                ShareSet { share_bps }.publish(&env);
            }
            ReferralAction::Upgrade(hash) => gov::upgrade_now(&env, &hash),
            ReferralAction::SetDelay(d) => gov::set_delay_now(&env, d),
        }
    }

    /// Referral share of fees, in basis points of the fee.
    pub fn share_bps(env: Env) -> u32 {
        gov::bump_instance(&env);
        env.storage().instance().get(&DataKey::ShareBps).unwrap_or(0)
    }

    /// Admin approves a contract (pool / vault) allowed to record earnings
    /// (bookkeeping only; cannot move funds).
    pub fn set_fee_source(env: Env, source: Address, allowed: bool) {
        gov::require_admin(&env);
        let key = DataKey::FeeSource(source.clone());
        if allowed {
            env.storage().persistent().set(&key, &true);
            bump(&env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
        FeeSourceSet { source, allowed }.publish(&env);
    }

    pub fn is_fee_source(env: Env, source: Address) -> bool {
        let key = DataKey::FeeSource(source);
        let v = env.storage().persistent().get(&key).unwrap_or(false);
        bump(&env, &key);
        v
    }

    /// Set the caller's referrer. Can only be done once. Paused by the guardian.
    pub fn set_referrer(env: Env, user: Address, referrer: Address) {
        user.require_auth();
        gov::bump_instance(&env);
        gov::when_not_paused(&env);
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
                    depth = depth.saturating_add(1);
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
        env.storage().persistent().set(&ckey, &count.saturating_add(1));
        bump(&env, &ckey);
        ReferrerSet { user, referrer }.publish(&env);
    }

    pub fn get_referrer(env: Env, user: Address) -> Option<Address> {
        gov::bump_instance(&env);
        let key = DataKey::Referrer(user);
        let v = env.storage().persistent().get(&key);
        bump(&env, &key);
        v
    }

    pub fn referral_count(env: Env, referrer: Address) -> u32 {
        let key = DataKey::Count(referrer);
        let v = env.storage().persistent().get(&key).unwrap_or(0);
        bump(&env, &key);
        v
    }

    pub fn earned(env: Env, referrer: Address, token: Address) -> i128 {
        let key = DataKey::Earned(referrer, token);
        let v = env.storage().persistent().get(&key).unwrap_or(0);
        bump(&env, &key);
        v
    }

    /// Bookkeeping hook called by approved fee sources after they have paid
    /// `amount` of `token` to `referrer`.
    pub fn record_reward(env: Env, source: Address, referrer: Address, token: Address, amount: i128) {
        source.require_auth();
        gov::bump_instance(&env);
        if !Self::is_fee_source(env.clone(), source.clone()) {
            panic_with_error!(&env, ReferralError::NotFeeSource);
        }
        if amount < 0 {
            panic_with_error!(&env, ReferralError::NegativeAmount);
        }
        let key = DataKey::Earned(referrer.clone(), token.clone());
        let cur: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &gov::add(&env, cur, amount));
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
