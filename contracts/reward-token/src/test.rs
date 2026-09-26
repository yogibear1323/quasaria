#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::TokenClient,
    Address, Env, String,
};

const UNIT: i128 = 10_000_000; // 7 decimals

fn setup(apr_bps: u32, max_supply: i128) -> (Env, QuasariaFluxClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let admin = Address::generate(&env);
    let id = env.register(
        QuasariaFlux,
        (
            &admin,
            7u32,
            String::from_str(&env, "Quasaria Flux"),
            String::from_str(&env, "QFX"),
            apr_bps,
            max_supply,
        ),
    );
    (env.clone(), QuasariaFluxClient::new(&env, &id), admin)
}

fn advance_days(env: &Env, days: u64) {
    let t = env.ledger().timestamp();
    env.ledger().set_timestamp(t + days * DAY_SECONDS);
}

#[test]
fn metadata_and_sep41_client() {
    let (env, c, _) = setup(1_000, 1_000_000_000 * UNIT);
    let t = TokenClient::new(&env, &c.address);
    assert_eq!(t.name(), String::from_str(&env, "Quasaria Flux"));
    assert_eq!(t.symbol(), String::from_str(&env, "QFX"));
    assert_eq!(t.decimals(), 7);
    let a = Address::generate(&env);
    c.mint(&a, &(100 * UNIT));
    assert_eq!(t.balance(&a), 100 * UNIT);
}

#[test]
fn compounds_daily_for_holders() {
    let (env, c, _) = setup(1_000, 1_000_000_000 * UNIT); // 10% APR
    let a = Address::generate(&env);
    c.mint(&a, &(1_000 * UNIT));
    // Less than a day: nothing accrues.
    env.ledger().set_timestamp(env.ledger().timestamp() + DAY_SECONDS - 1);
    assert_eq!(c.balance(&a), 1_000 * UNIT);
    // After one day: 1000 * (1 + 0.10/365)
    advance_days(&env, 1);
    let one_day = c.balance(&a);
    let expected = 1_000 * UNIT + 1_000 * UNIT * 1_000 / (10_000 * 365);
    assert!((one_day - expected).abs() <= 1, "{one_day} vs {expected}");
    // After a full year: ~ 1000 * (1+0.1/365)^365 = 1105.155...
    advance_days(&env, 364);
    let year = c.balance(&a);
    let lo = 1_105_150 * UNIT / 1_000;
    let hi = 1_105_160 * UNIT / 1_000;
    assert!(year > lo && year < hi, "year balance {year}");
    assert_eq!(c.current_apy_bps(), 1_051); // 10.51% APY
}

#[test]
fn compounding_is_path_independent() {
    // Touching the index daily yields the same result as a lazy update.
    let (env, c, _) = setup(2_000, 1_000_000_000 * UNIT);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    c.mint(&a, &(500 * UNIT));
    c.mint(&b, &(500 * UNIT));
    for _ in 0..30 {
        advance_days(&env, 1);
        c.accrue();
    }
    let lazy_index = pow_fixed(daily_factor(2_000), 30);
    assert!((c.index() - lazy_index).abs() <= 30);
    assert_eq!(c.balance(&a), c.balance(&b));
}

#[test]
fn transfers_move_shares_and_keep_earning() {
    let (env, c, _) = setup(1_000, 1_000_000_000 * UNIT);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    c.mint(&a, &(1_000 * UNIT));
    advance_days(&env, 10);
    let a_bal = c.balance(&a);
    c.transfer(&a, &b, &(a_bal / 2));
    assert!(c.balance(&b) >= a_bal / 2);
    assert!(c.balance(&a) + c.balance(&b) <= a_bal);
    let b_before = c.balance(&b);
    advance_days(&env, 10);
    assert!(c.balance(&b) > b_before, "receiver keeps compounding");
    // overspend fails
    let r = c.try_transfer(&b, &a, &(c.balance(&b) + 1));
    assert_eq!(r, Err(Ok(TokenError::InsufficientBalance.into())));
}

#[test]
fn apr_is_capped_and_changes_apply_forward() {
    let (env, c, _) = setup(1_000, 1_000_000_000 * UNIT);
    assert_eq!(
        c.try_set_apr_bps(&(MAX_APR_BPS + 1)),
        Err(Ok(TokenError::AprTooHigh.into()))
    );
    let a = Address::generate(&env);
    c.mint(&a, &(1_000 * UNIT));
    advance_days(&env, 5);
    let before = c.balance(&a);
    c.set_apr_bps(&0);
    advance_days(&env, 100);
    assert_eq!(c.balance(&a), before, "zero APR stops growth");
}

#[test]
fn emission_bounded_by_max_supply() {
    let cap = 1_010 * UNIT;
    let (env, c, _) = setup(MAX_APR_BPS, cap);
    let a = Address::generate(&env);
    c.mint(&a, &(1_000 * UNIT));
    assert_eq!(
        c.try_mint(&a, &(20 * UNIT)),
        Err(Ok(TokenError::MaxSupplyExceeded.into()))
    );
    advance_days(&env, 3650);
    let s = c.total_supply();
    assert!(s <= cap && s >= cap - 2, "supply {s}");
    assert!(c.balance(&a) <= cap);
    // lowering cap below supply is rejected, raising is rejected
    assert!(c.try_set_max_supply(&(cap + 1)).is_err());
    assert!(c.try_set_max_supply(&(s - 10)).is_err());
}

#[test]
fn allowance_and_burn() {
    let (env, c, _) = setup(0, 1_000_000_000 * UNIT);
    let a = Address::generate(&env);
    let s = Address::generate(&env);
    let r = Address::generate(&env);
    c.mint(&a, &(100 * UNIT));
    let exp = env.ledger().sequence() + 1_000;
    c.approve(&a, &s, &(40 * UNIT), &exp);
    assert_eq!(c.allowance(&a, &s), 40 * UNIT);
    c.transfer_from(&s, &a, &r, &(30 * UNIT));
    assert_eq!(c.balance(&r), 30 * UNIT);
    assert_eq!(c.allowance(&a, &s), 10 * UNIT);
    assert_eq!(
        c.try_transfer_from(&s, &a, &r, &(11 * UNIT)),
        Err(Ok(TokenError::InsufficientAllowance.into()))
    );
    c.burn_from(&s, &a, &(10 * UNIT));
    c.burn(&r, &(5 * UNIT));
    assert_eq!(c.total_supply(), 85 * UNIT);
}

#[test]
fn pow_fixed_matches_repeated_multiplication() {
    let f = daily_factor(1_500);
    let mut acc = SCALE;
    for _ in 0..17 {
        acc = mul_div_floor(acc, f, SCALE);
    }
    assert!((pow_fixed(f, 17) - acc).abs() <= 17);
    assert_eq!(pow_fixed(f, 0), SCALE);
}
