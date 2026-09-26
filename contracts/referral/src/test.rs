#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, ReferralRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(ReferralRegistry, (&admin, 2_000u32));
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

#[test]
fn share_is_capped() {
    let (_env, c, _) = setup();
    assert_eq!(c.share_bps(), 2_000);
    c.set_share_bps(&3_000);
    assert_eq!(c.share_bps(), 3_000);
    assert_eq!(
        c.try_set_share_bps(&(MAX_SHARE_BPS + 1)),
        Err(Ok(ReferralError::ShareTooHigh.into()))
    );
}
