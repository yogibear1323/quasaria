#![cfg(test)]
extern crate std;

use super::*;
use quasaria_gov::GovError;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Ledger,
    },
    Address, Env,
};

const DELAY: u64 = 600;

fn setup() -> (Env, ReferralRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);
    let admin = Address::generate(&env);
    let id = env.register(ReferralRegistry, (&admin, 2_000u32, DELAY));
    let client = ReferralRegistryClient::new(&env, &id);
    (env, client, admin)
}

#[test]
fn set_referrer_once_and_count() {
    let (env, c, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    c.set_referrer(&bob, &alice);
    c.set_referrer(&carol, &alice);
    assert_eq!(c.get_referrer(&bob), Some(alice.clone()));
    assert_eq!(c.referral_count(&alice), 2);
    assert_eq!(c.get_referrer(&alice), None);
    // second attempt fails
    let r = c.try_set_referrer(&bob, &carol);
    assert_eq!(r, Err(Ok(ReferralError::AlreadySet.into())));
}

#[test]
fn rejects_self_referral() {
    let (env, c, _) = setup();
    let alice = Address::generate(&env);
    assert_eq!(
        c.try_set_referrer(&alice, &alice),
        Err(Ok(ReferralError::SelfReferral.into()))
    );
}

#[test]
fn rejects_cycles() {
    let (env, c, _) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let d = Address::generate(&env);
    c.set_referrer(&b, &a); // a <- b
    c.set_referrer(&d, &b); // b <- d
    // a trying to set d as referrer would create a -> d -> b -> a
    assert_eq!(c.try_set_referrer(&a, &d), Err(Ok(ReferralError::Cycle.into())));
    assert_eq!(c.try_set_referrer(&a, &b), Err(Ok(ReferralError::Cycle.into())));
}

#[test]
fn only_fee_sources_record() {
    let (env, c, _) = setup();
    let pool = Address::generate(&env);
    let referrer = Address::generate(&env);
    let token = Address::generate(&env);
    assert_eq!(
        c.try_record_reward(&pool, &referrer, &token, &10),
        Err(Ok(ReferralError::NotFeeSource.into()))
    );
    c.set_fee_source(&pool, &true);
    c.record_reward(&pool, &referrer, &token, &10);
    c.record_reward(&pool, &referrer, &token, &5);
    assert_eq!(c.earned(&referrer, &token), 15);
    c.set_fee_source(&pool, &false);
    assert!(!c.is_fee_source(&pool));
}

fn warp(env: &Env, secs: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + secs);
}

#[test]
fn share_is_capped_and_timelocked() {
    let (env, c, _) = setup();
    assert_eq!(c.share_bps(), 2_000);
    let a = ReferralAction::SetShareBps(3_000);
    c.propose_action(&a);
    assert_eq!(c.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
    assert_eq!(c.share_bps(), 2_000);
    warp(&env, DELAY);
    c.execute_action(&a);
    assert_eq!(c.share_bps(), 3_000);
    let bad = ReferralAction::SetShareBps(MAX_SHARE_BPS + 1);
    c.propose_action(&bad);
    warp(&env, DELAY);
    assert_eq!(c.try_execute_action(&bad), Err(Ok(ReferralError::ShareTooHigh.into())));
}

#[test]
fn pause_blocks_set_referrer_but_not_bookkeeping() {
    let (env, c, _) = setup();
    let guardian = Address::generate(&env);
    c.set_guardian(&guardian);
    c.pause(&guardian);
    assert!(c.paused());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    assert_eq!(c.try_set_referrer(&b, &a), Err(Ok(GovError::Paused.into())));
    // fee sources can still record (swaps must not break while paused)
    let pool = Address::generate(&env);
    c.set_fee_source(&pool, &true);
    c.record_reward(&pool, &a, &pool, &1);
    c.unpause();
    c.set_referrer(&b, &a);
}

#[test]
fn two_step_admin() {
    let (env, c, admin) = setup();
    let ms = Address::generate(&env);
    c.propose_admin(&ms);
    assert_eq!(c.admin(), admin);
    assert_eq!(c.pending_admin(), Some(ms.clone()));
    c.accept_admin();
    assert_eq!(c.admin(), ms);
}

/// Regression F-08: instance and persistent TTLs are extended on use.
#[test]
fn regression_f08_ttl_extended() {
    let (env, c, _) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    c.set_referrer(&b, &a);
    env.as_contract(&c.address, || {
        assert!(env.storage().instance().get_ttl() >= quasaria_gov::INSTANCE_BUMP_TO - 1);
    });
    // let the entries age, then a read (as done by pools on every swap) re-bumps them
    let seq = env.ledger().sequence();
    env.ledger().set_sequence_number(seq + quasaria_gov::PERSISTENT_BUMP_TO - quasaria_gov::PERSISTENT_BUMP_THRESHOLD + 10);
    c.get_referrer(&b);
    env.as_contract(&c.address, || {
        assert!(
            env.storage().persistent().get_ttl(&DataKey::Referrer(b.clone()))
                >= quasaria_gov::PERSISTENT_BUMP_TO - 1
        );
        assert!(env.storage().instance().get_ttl() >= quasaria_gov::INSTANCE_BUMP_TO - 1);
    });
}
