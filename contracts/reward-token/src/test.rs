#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, IntoVal, String, Symbol, Val, Vec,
};

const UNIT: i128 = 10_000_000; // 7 decimals, same as XLM

struct T {
    env: Env,
    c: QuasariaFluxClient<'static>,
    xlm: TokenClient<'static>,
    xlm_admin: StellarAssetClient<'static>,
    admin: Address,
}

fn setup(apr_bps: u32) -> T {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let admin = Address::generate(&env);
    // Stand-in for the native XLM SAC (same interface, 7 decimals).
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(
        QuasariaFlux,
        (
            &admin,
            &sac.address(),
            String::from_str(&env, "Quasaria Flux"),
            String::from_str(&env, "QFX"),
            apr_bps,
        ),
    );
    T {
        c: QuasariaFluxClient::new(&env, &id),
        xlm: TokenClient::new(&env, &sac.address()),
        xlm_admin: StellarAssetClient::new(&env, &sac.address()),
        env,
        admin,
    }
}

/// A user holding `xlm` testnet XLM.
fn user(t: &T, xlm: i128) -> Address {
    let u = Address::generate(&t.env);
    if xlm > 0 {
        t.xlm_admin.mint(&u, &xlm);
    }
    u
}

fn advance_days(env: &Env, days: u64) {
    let t = env.ledger().timestamp();
    env.ledger().set_timestamp(t + days * DAY_SECONDS);
}

/// The peg invariant: XLM held by the contract == QFX total supply, and it
/// covers every balance plus the reward reserve.
fn assert_peg(t: &T, holders: &[&Address]) {
    let r = t.c.reserves();
    assert_eq!(
        r.xlm_reserve,
        t.xlm.balance(&t.c.address),
        "reserve view = SAC balance"
    );
    assert_eq!(r.xlm_reserve, r.total_supply, "reserve == supply");
    assert_eq!(r.surplus, 0);
    assert!(r.fully_backed);
    assert_eq!(r.circulating + r.reward_reserve, r.total_supply);
    let held: i128 = holders.iter().map(|h| t.c.balance(h)).sum();
    let y = t.c.yield_info();
    assert!(
        held + y.reward_pool <= r.total_supply,
        "claims {held} + pool {} exceed supply {}",
        y.reward_pool,
        r.total_supply
    );
}

#[test]
fn metadata_decimals_match_xlm() {
    let t = setup(1_000);
    let q = TokenClient::new(&t.env, &t.c.address);
    assert_eq!(q.name(), String::from_str(&t.env, "Quasaria Flux"));
    assert_eq!(q.symbol(), String::from_str(&t.env, "QFX"));
    assert_eq!(q.decimals(), 7);
    assert_eq!(q.decimals(), t.xlm.decimals());
    assert_eq!(t.c.xlm(), t.xlm.address);
    assert_eq!(t.c.total_supply(), 0);
    assert_peg(&t, &[]);
}

#[test]
fn deposit_mints_one_to_one_and_reserve_equals_supply() {
    let t = setup(0);
    let a = user(&t, 1_000 * UNIT);
    let b = user(&t, 500 * UNIT);
    assert_eq!(t.c.deposit(&a, &(250 * UNIT)), 250 * UNIT);
    assert_eq!(t.c.balance(&a), 250 * UNIT);
    assert_eq!(t.xlm.balance(&a), 750 * UNIT);
    assert_peg(&t, &[&a, &b]);
    t.c.deposit(&b, &(500 * UNIT));
    assert_eq!(t.c.total_supply(), 750 * UNIT);
    assert_eq!(t.xlm.balance(&t.c.address), 750 * UNIT);
    assert_peg(&t, &[&a, &b]);
    // zero / negative deposits rejected
    assert_eq!(
        t.c.try_deposit(&a, &0),
        Err(Ok(TokenError::ZeroAmount.into()))
    );
    assert_eq!(
        t.c.try_deposit(&a, &-1),
        Err(Ok(TokenError::ZeroAmount.into()))
    );
}

#[test]
fn redeem_returns_xlm_one_to_one() {
    let t = setup(0);
    let a = user(&t, 1_000 * UNIT);
    t.c.deposit(&a, &(1_000 * UNIT));
    assert_eq!(t.c.redeem(&a, &(400 * UNIT)), 400 * UNIT);
    assert_eq!(t.c.balance(&a), 600 * UNIT);
    assert_eq!(t.xlm.balance(&a), 400 * UNIT);
    assert_peg(&t, &[&a]);
    t.c.redeem(&a, &(600 * UNIT));
    assert_eq!(t.c.balance(&a), 0);
    assert_eq!(t.xlm.balance(&a), 1_000 * UNIT, "full round trip, no loss");
    assert_eq!(t.c.total_supply(), 0);
    assert_peg(&t, &[&a]);
}

#[test]
fn redeem_more_than_balance_fails() {
    let t = setup(0);
    let a = user(&t, 100 * UNIT);
    let b = user(&t, 100 * UNIT);
    t.c.deposit(&a, &(100 * UNIT));
    t.c.deposit(&b, &(100 * UNIT));
    assert_eq!(
        t.c.try_redeem(&a, &(100 * UNIT + 1)),
        Err(Ok(TokenError::InsufficientBalance.into()))
    );
    // a user with no QFX cannot pull other holders' collateral
    let c = user(&t, 0);
    assert_eq!(
        t.c.try_redeem(&c, &1),
        Err(Ok(TokenError::InsufficientBalance.into()))
    );
    assert_eq!(
        t.c.try_redeem(&a, &0),
        Err(Ok(TokenError::ZeroAmount.into()))
    );
    assert_eq!(t.c.balance(&a), 100 * UNIT);
    assert_eq!(t.xlm.balance(&t.c.address), 200 * UNIT);
    assert_peg(&t, &[&a, &b, &c]);
}

#[test]
fn no_unbacked_mint() {
    let t = setup(MAX_APR_BPS);
    // The old admin `mint` entry point no longer exists.
    let args: Vec<Val> = (t.admin.clone(), 1_000 * UNIT).into_val(&t.env);
    let r = t.env.try_invoke_contract::<Val, soroban_sdk::Error>(
        &t.c.address,
        &Symbol::new(&t.env, "mint"),
        args,
    );
    assert!(r.is_err(), "mint must not exist");
    // Depositing without XLM fails and mints nothing.
    let broke = user(&t, 0);
    assert!(t.c.try_deposit(&broke, &(10 * UNIT)).is_err());
    assert!(t.c.try_fund_yield(&broke, &(10 * UNIT)).is_err());
    assert_eq!(t.c.total_supply(), 0);
    // Admin knobs never change supply.
    let a = user(&t, 100 * UNIT);
    t.c.deposit(&a, &(100 * UNIT));
    t.c.set_apr_bps(&MAX_APR_BPS);
    t.c.set_yield_exempt(&a, &true);
    t.c.set_yield_exempt(&a, &false);
    advance_days(&t.env, 365);
    t.c.accrue();
    t.c.settle(&a);
    // No reserve funded -> no yield at all, even at max APR for a year.
    assert_eq!(t.c.balance(&a), 100 * UNIT);
    assert_eq!(t.c.total_supply(), 100 * UNIT);
    assert_eq!(t.c.sweep_surplus(), 0);
    assert_peg(&t, &[&a]);
}

#[test]
fn holder_yield_is_paid_from_the_reserve_not_minted() {
    let t = setup(1_000); // 10% APR
    let funder = user(&t, 100 * UNIT);
    t.c.fund_yield(&funder, &(100 * UNIT));
    assert_eq!(t.c.reserves().reward_reserve, 100 * UNIT);
    let a = user(&t, 1_000 * UNIT);
    t.c.deposit(&a, &(1_000 * UNIT));
    let supply = t.c.total_supply();
    assert_eq!(supply, 1_100 * UNIT);
    assert_peg(&t, &[&a]);

    // Less than a day: nothing.
    t.env
        .ledger()
        .set_timestamp(t.env.ledger().timestamp() + DAY_SECONDS - 1);
    assert_eq!(t.c.balance(&a), 1_000 * UNIT);
    // One day: 1000 * 0.10 / 365 paid out of the reserve.
    advance_days(&t.env, 1);
    let expected = 1_000 * UNIT * 1_000 / (10_000 * 365);
    let got = t.c.balance(&a) - 1_000 * UNIT;
    assert!((got - expected).abs() <= 1, "{got} vs {expected}");
    assert_eq!(t.c.pending_yield(&a), got);
    assert_eq!(t.c.total_supply(), supply, "yield does not change supply");
    assert_peg(&t, &[&a]);
    // Settling credits it; reserve shrinks by the same amount.
    assert_eq!(t.c.settle(&a), got);
    assert_eq!(t.c.pending_yield(&a), 0);
    let y = t.c.yield_info();
    assert!(y.reward_pool + y.accrued_unsettled + got <= 100 * UNIT);
    assert_eq!(t.c.total_supply(), supply);
    assert_peg(&t, &[&a]);
    // Redeem everything the holder has (principal + yield) for XLM.
    let bal = t.c.balance(&a);
    t.c.redeem(&a, &bal);
    assert_eq!(t.xlm.balance(&a), bal);
    assert_peg(&t, &[&a]);
    assert_eq!(t.c.current_apy_bps(), 1_051); // 10.51% APY from daily compounding
}

#[test]
fn yield_stops_when_reserve_runs_dry() {
    let t = setup(MAX_APR_BPS);
    let funder = user(&t, 5 * UNIT);
    t.c.fund_yield(&funder, &(5 * UNIT));
    let a = user(&t, 1_000 * UNIT);
    let b = user(&t, 1_000 * UNIT);
    t.c.deposit(&a, &(1_000 * UNIT));
    t.c.deposit(&b, &(1_000 * UNIT));
    for _ in 0..40 {
        advance_days(&t.env, 90);
        t.c.accrue();
        assert_peg(&t, &[&a, &b]);
    }
    let y = t.c.yield_info();
    assert_eq!(y.reward_pool, 0, "reserve exhausted");
    let total = t.c.balance(&a) + t.c.balance(&b);
    assert!(
        total <= 2_005 * UNIT && total >= 2_005 * UNIT - 2,
        "total {total}"
    );
    // everyone can still exit at 1:1
    let (ba, bb) = (t.c.balance(&a), t.c.balance(&b));
    t.c.redeem(&a, &ba);
    t.c.redeem(&b, &bb);
    assert_eq!(t.xlm.balance(&a) + t.xlm.balance(&b), ba + bb);
    assert_peg(&t, &[&a, &b]);
    assert!(
        t.c.total_supply() <= 2,
        "only rounding dust left in the reserve"
    );
}

#[test]
fn exempt_contracts_do_not_earn() {
    let t = setup(1_000);
    let funder = user(&t, 50 * UNIT);
    t.c.fund_yield(&funder, &(50 * UNIT));
    let a = user(&t, 1_000 * UNIT);
    let staking = user(&t, 1_000 * UNIT);
    t.c.set_yield_exempt(&staking, &true);
    assert!(t.c.is_yield_exempt(&staking));
    t.c.deposit(&a, &(1_000 * UNIT));
    t.c.deposit(&staking, &(1_000 * UNIT));
    assert_eq!(t.c.yield_info().eligible_supply, 1_000 * UNIT);
    advance_days(&t.env, 30);
    assert_eq!(t.c.balance(&staking), 1_000 * UNIT);
    assert!(t.c.balance(&a) > 1_000 * UNIT);
    assert_peg(&t, &[&a, &staking]);
}

#[test]
fn transfers_settle_and_keep_earning() {
    let t = setup(1_000);
    let funder = user(&t, 100 * UNIT);
    t.c.fund_yield(&funder, &(100 * UNIT));
    let a = user(&t, 1_000 * UNIT);
    let b = user(&t, 0);
    t.c.deposit(&a, &(1_000 * UNIT));
    advance_days(&t.env, 10);
    let a_bal = t.c.balance(&a);
    t.c.transfer(&a, &b, &(a_bal / 2));
    assert_eq!(
        t.c.balance(&b),
        a_bal / 2,
        "receiver does not inherit past yield"
    );
    assert_eq!(t.c.balance(&a), a_bal - a_bal / 2);
    let b_before = t.c.balance(&b);
    advance_days(&t.env, 10);
    assert!(t.c.balance(&b) > b_before, "receiver earns from now on");
    let r = t.c.try_transfer(&b, &a, &(t.c.balance(&b) + 1));
    assert_eq!(r, Err(Ok(TokenError::InsufficientBalance.into())));
    assert_peg(&t, &[&a, &b]);
}

#[test]
fn fees_can_fund_the_reserve_in_qfx() {
    let t = setup(1_000);
    let fees = user(&t, 20 * UNIT);
    t.c.deposit(&fees, &(20 * UNIT));
    t.c.fund_yield_qfx(&fees, &(20 * UNIT));
    assert_eq!(t.c.balance(&fees), 0);
    assert_eq!(t.c.yield_info().reward_pool, 20 * UNIT);
    assert_eq!(t.c.total_supply(), 20 * UNIT);
    assert_peg(&t, &[&fees]);
}

#[test]
fn donated_xlm_is_swept_into_the_reserve() {
    let t = setup(1_000);
    let a = user(&t, 100 * UNIT);
    t.c.deposit(&a, &(50 * UNIT));
    t.xlm.transfer(&a, &t.c.address, &(7 * UNIT)); // raw SAC transfer, no deposit
    let r = t.c.reserves();
    assert_eq!(r.surplus, 7 * UNIT);
    assert!(r.fully_backed);
    assert_eq!(t.c.sweep_surplus(), 7 * UNIT);
    assert_eq!(t.c.yield_info().reward_pool, 7 * UNIT);
    assert_peg(&t, &[&a]);
}

#[test]
fn burn_is_redeem_and_allowances_work() {
    let t = setup(0);
    let a = user(&t, 100 * UNIT);
    let s = user(&t, 0);
    let r = user(&t, 0);
    t.c.deposit(&a, &(100 * UNIT));
    let exp = t.env.ledger().sequence() + 1_000;
    t.c.approve(&a, &s, &(40 * UNIT), &exp);
    assert_eq!(t.c.allowance(&a, &s), 40 * UNIT);
    t.c.transfer_from(&s, &a, &r, &(30 * UNIT));
    assert_eq!(t.c.balance(&r), 30 * UNIT);
    assert_eq!(t.c.allowance(&a, &s), 10 * UNIT);
    assert_eq!(
        t.c.try_transfer_from(&s, &a, &r, &(11 * UNIT)),
        Err(Ok(TokenError::InsufficientAllowance.into()))
    );
    t.c.burn_from(&s, &a, &(10 * UNIT)); // XLM back to the owner, not the spender
    assert_eq!(t.xlm.balance(&a), 10 * UNIT);
    assert_eq!(t.xlm.balance(&s), 0);
    t.c.burn(&r, &(5 * UNIT));
    assert_eq!(t.xlm.balance(&r), 5 * UNIT);
    assert_eq!(t.c.total_supply(), 85 * UNIT);
    assert_peg(&t, &[&a, &s, &r]);
}

#[test]
fn apr_is_capped() {
    let t = setup(1_000);
    assert_eq!(
        t.c.try_set_apr_bps(&(MAX_APR_BPS + 1)),
        Err(Ok(TokenError::AprTooHigh.into()))
    );
    let funder = user(&t, 100 * UNIT);
    t.c.fund_yield(&funder, &(100 * UNIT));
    let a = user(&t, 1_000 * UNIT);
    t.c.deposit(&a, &(1_000 * UNIT));
    advance_days(&t.env, 5);
    let before = t.c.balance(&a);
    t.c.set_apr_bps(&0);
    advance_days(&t.env, 100);
    assert_eq!(t.c.balance(&a), before, "zero APR stops yield");
}

#[test]
fn peg_holds_through_mixed_activity() {
    let t = setup(2_000);
    let f = user(&t, 1_000 * UNIT);
    t.c.fund_yield(&f, &(300 * UNIT));
    let us: std::vec::Vec<Address> = (0..4).map(|i| user(&t, (i + 1) * 1_000 * UNIT)).collect();
    let refs: std::vec::Vec<&Address> = us.iter().collect();
    for round in 0..25i128 {
        for (i, u) in us.iter().enumerate() {
            let i = i as i128;
            match (round + i) % 5 {
                0 => {
                    let x = t.xlm.balance(u) / 7;
                    if x > 0 {
                        t.c.deposit(u, &x);
                    }
                }
                1 => {
                    let q = t.c.balance(u) / 3;
                    if q > 0 {
                        t.c.redeem(u, &q);
                    }
                }
                2 => {
                    let q = t.c.balance(u) / 4;
                    let to = &us[((i + 1) % 4) as usize];
                    t.c.transfer(u, to, &q);
                }
                3 => {
                    t.c.settle(u);
                }
                _ => {}
            }
            assert_peg(&t, &refs);
        }
        if round == 10 {
            t.c.fund_yield(&f, &(50 * UNIT));
        }
        advance_days(&t.env, 3);
    }
    // Everyone exits: all XLM comes back, only rounding dust / unpaid reserve remains.
    for u in &us {
        let b = t.c.balance(u);
        if b > 0 {
            t.c.redeem(u, &b);
        }
    }
    assert_peg(&t, &refs);
    let y = t.c.yield_info();
    // Only the unpaid reserve plus a few stroops of rounding dust (in the reserve's favour) remain.
    assert_eq!(t.c.reserves().circulating, 0);
    let dust = t.c.total_supply() - y.reward_pool;
    assert!(dust >= 0 && dust <= 100, "dust {dust}");
}
