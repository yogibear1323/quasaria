#![cfg(test)]
extern crate std;

use super::*;
use quasaria_gov::GovError;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Ledger,
    },
    Address, Env, IntoVal, InvokeError, Symbol, Val,
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

fn exec(env: &Env, c: &ReferralRegistryClient, a: &ReferralAction) {
    let eta = c.propose_action(a);
    env.ledger().set_timestamp(eta);
    c.execute_action(a);
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
    exec(&env, &c, &ReferralAction::SetFeeSource(pool.clone(), true));
    c.record_reward(&pool, &referrer, &token, &10);
    c.record_reward(&pool, &referrer, &token, &5);
    assert_eq!(c.earned(&referrer, &token), 15);
    exec(&env, &c, &ReferralAction::SetFeeSource(pool.clone(), false));
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
    // rejected when queued (validated again on execution)
    let bad = ReferralAction::SetShareBps(MAX_SHARE_BPS + 1);
    assert_eq!(c.try_propose_action(&bad), Err(Ok(ReferralError::ShareTooHigh.into())));
}

#[test]
fn pause_blocks_set_referrer_but_not_bookkeeping() {
    let (env, c, _) = setup();
    let guardian = Address::generate(&env);
    exec(&env, &c, &ReferralAction::SetGuardian(guardian.clone()));
    c.pause(&guardian);
    assert!(c.paused());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    assert_eq!(c.try_set_referrer(&b, &a), Err(Ok(GovError::Paused.into())));
    // fee sources can still record (swaps must not break while paused)
    let pool = Address::generate(&env);
    exec(&env, &c, &ReferralAction::SetFeeSource(pool.clone(), true));
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

// ------------------------------------------------------------------ Step 1: timelocked setters

#[test]
fn step1_instant_setters_rejected() {
    let (env, c, _) = setup();
    let pool = Address::generate(&env);
    for (name, args) in [
        ("set_fee_source", (pool.clone(), true).into_val(&env)),
        ("set_guardian", (pool.clone(),).into_val(&env)),
    ] {
        let r = env.try_invoke_contract::<Val, InvokeError>(&c.address, &Symbol::new(&env, name), args);
        assert!(r.is_err(), "instant `{name}` must not exist");
    }
    assert!(!c.is_fee_source(&pool));
    assert_ne!(c.guardian(), pool);
}

#[test]
fn step1_fee_source_queue_wait_execute() {
    let (env, c, _) = setup();
    let pool = Address::generate(&env);
    let a = ReferralAction::SetFeeSource(pool.clone(), true);
    assert_eq!(c.propose_action(&a), 10_000 + DELAY);
    assert_eq!(c.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
    assert!(!c.is_fee_source(&pool));
    warp(&env, DELAY);
    c.execute_action(&a);
    assert!(c.is_fee_source(&pool));
}

#[test]
fn step1_guardian_cancels_fee_source_and_guardian_swap() {
    let (env, c, _) = setup();
    let g = Address::generate(&env);
    exec(&env, &c, &ReferralAction::SetGuardian(g.clone()));
    let rogue = Address::generate(&env);
    let a = ReferralAction::SetFeeSource(rogue.clone(), true);
    let swap = ReferralAction::SetGuardian(rogue.clone());
    c.propose_action(&a);
    c.propose_action(&swap);
    c.cancel_action(&g, &a);
    c.cancel_action(&g, &swap);
    warp(&env, DELAY);
    assert_eq!(c.try_execute_action(&a), Err(Ok(GovError::NotQueued.into())));
    assert_eq!(c.try_execute_action(&swap), Err(Ok(GovError::NotQueued.into())));
    assert!(!c.is_fee_source(&rogue));
    assert_eq!(c.guardian(), g);
}

#[test]
fn step1_mainnet_delay_floors() {
    let env = Env::default();
    env.mock_all_auths();
    let h = env
        .crypto()
        .sha256(&soroban_sdk::Bytes::from_slice(&env, quasaria_gov::MAINNET_PASSPHRASE))
        .to_array();
    env.ledger().set_network_id(h);
    let admin = Address::generate(&env);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(ReferralRegistry, (&admin, 2_000u32, DELAY));
    }));
    assert!(r.is_err());
    let c = ReferralRegistryClient::new(&env, &env.register(ReferralRegistry, (&admin, 2_000u32, 48u64 * 3_600)));
    let p = Address::generate(&env);
    assert_eq!(c.action_delay(&ReferralAction::SetFeeSource(p.clone(), true)), 48 * 3_600);
    assert_eq!(c.action_delay(&ReferralAction::SetGuardian(p)), 48 * 3_600);
    assert_eq!(c.action_delay(&ReferralAction::SetShareBps(1)), 48 * 3_600);
    assert_eq!(c.action_delay(&ReferralAction::SetDelay(48 * 3_600)), 72 * 3_600);
    assert_eq!(
        c.action_delay(&ReferralAction::Upgrade(soroban_sdk::BytesN::from_array(&env, &[2; 32]))),
        72 * 3_600
    );
}
