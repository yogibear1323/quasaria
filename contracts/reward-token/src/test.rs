#![cfg(test)]
extern crate std;

use super::*;
use quasaria_gov::GovError;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Ledger,
    },
    token::{StellarAssetClient, TokenClient},
    Address, Env, IntoVal, String, Symbol, Val, Vec,
};

const UNIT: i128 = 10_000_000; // 7 decimals, same as XLM
const DELAY: u64 = 600;
/// Default liability cap in tests: 1,000,000 QFX.
const CAP: i128 = 1_000_000 * UNIT;

struct T {
    env: Env,
    c: QuasariaFluxClient<'static>,
    xlm: TokenClient<'static>,
    xlm_admin: StellarAssetClient<'static>,
    admin: Address,
}

fn setup(apr_bps: u32) -> T {
    setup_cap(apr_bps, CAP)
}

fn setup_cap(apr_bps: u32, cap: i128) -> T {
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
            cap,
            DELAY,
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

fn advance_secs(env: &Env, secs: u64) {
    let t = env.ledger().timestamp();
    env.ledger().set_timestamp(t + secs);
}

/// Queue a timelocked action, wait the delay, execute it.
fn timelocked(t: &T, a: &QfxAction) {
    t.c.propose_action(a);
    advance_secs(&t.env, DELAY);
    t.c.execute_action(a);
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
    timelocked(&t, &QfxAction::SetAprBps(MAX_APR_BPS));
    timelocked(&t, &QfxAction::SetYieldExempt(a.clone(), true));
    timelocked(&t, &QfxAction::SetYieldExempt(a.clone(), false));
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

    // Half a day: half a day's yield (time-weighted, per second).
    advance_secs(&t.env, DAY_SECONDS / 2);
    let half = 1_000 * UNIT * 1_000 / (10_000 * 365 * 2);
    let got_half = t.c.balance(&a) - 1_000 * UNIT;
    assert!((got_half - half).abs() <= 1, "{got_half} vs {half}");
    // One day: 1000 * 0.10 / 365 paid out of the reserve.
    advance_secs(&t.env, DAY_SECONDS / 2);
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
        (2_005 * UNIT - 2..=2_005 * UNIT).contains(&total),
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
    timelocked(&t, &QfxAction::SetYieldExempt(staking.clone(), true));
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
fn apr_is_capped_and_timelocked() {
    let t = setup(1_000);
    // rejected when queued (and again on execution)
    let too_high = QfxAction::SetAprBps(MAX_APR_BPS + 1);
    assert_eq!(
        t.c.try_propose_action(&too_high),
        Err(Ok(TokenError::AprTooHigh.into()))
    );
    let funder = user(&t, 100 * UNIT);
    t.c.fund_yield(&funder, &(100 * UNIT));
    let a = user(&t, 1_000 * UNIT);
    t.c.deposit(&a, &(1_000 * UNIT));
    advance_days(&t.env, 5);
    let zero = QfxAction::SetAprBps(0);
    t.c.propose_action(&zero);
    // early execution rejected; APR unchanged
    assert_eq!(t.c.try_execute_action(&zero), Err(Ok(GovError::TimelockNotReady.into())));
    assert_eq!(t.c.yield_info().apr_bps, 1_000);
    advance_secs(&t.env, DELAY);
    t.c.execute_action(&zero);
    let before = t.c.balance(&a);
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
    assert!((0..=100).contains(&dust), "dust {dust}");
}

// ------------------------------------------------------------------ F-03

/// Regression F-03 (PoC scenario): a whale deposits 60 s before the UTC-day
/// boundary and redeems 60 s after. It used to extract a full day of yield
/// (328.77 XLM on 1,000,000 XLM); now it earns only its 120 seconds.
#[test]
fn regression_f03_boundary_sniping_earns_only_seconds_held() {
    let t = setup(1_200);
    let funder = user(&t, 100_000 * UNIT);
    t.c.fund_yield(&funder, &(100_000 * UNIT));
    let holder = user(&t, 1_000 * UNIT);
    t.c.deposit(&holder, &(1_000 * UNIT));
    let g = t.env.ledger().timestamp();
    t.env.ledger().set_timestamp(g + DAY_SECONDS - 60);
    let whale = user(&t, 1_000_000 * UNIT);
    t.c.deposit(&whale, &(1_000_000 * UNIT));
    t.env.ledger().set_timestamp(g + DAY_SECONDS + 60);
    let bal = t.c.balance(&whale);
    t.c.redeem(&whale, &bal);
    let profit = t.xlm.balance(&whale) - 1_000_000 * UNIT;
    // 120 s of 12% APR on (at most) 1,000,000 QFX
    let max_fair = 1_000_000 * UNIT * 1_200 * 120 / (10_000 * 365 * 86_400);
    std::println!(
        "F-03 regression: whale held 120 s across the boundary, profit = {} stroops ({} XLM); fair 120 s share <= {}",
        profit, profit as f64 / 1e7, max_fair
    );
    assert!(profit <= max_fair + 1, "profit {profit} > fair {max_fair}");
    assert!(profit < UNIT, "less than 1 XLM (was 328.77 XLM)");
    assert_peg(&t, &[&holder, &whale]);
}

/// Regression F-03: yield is proportional to seconds held.
#[test]
fn regression_f03_yield_is_time_weighted() {
    let t = setup(1_000);
    let funder = user(&t, 1_000 * UNIT);
    t.c.fund_yield(&funder, &(1_000 * UNIT));
    let a = user(&t, 1_000 * UNIT);
    let b = user(&t, 1_000 * UNIT);
    t.c.deposit(&a, &(1_000 * UNIT));
    advance_secs(&t.env, 43_200);
    t.c.deposit(&b, &(1_000 * UNIT));
    advance_secs(&t.env, 43_200);
    let ya = t.c.balance(&a) - 1_000 * UNIT;
    let yb = t.c.balance(&b) - 1_000 * UNIT;
    assert!(ya > 0 && yb > 0);
    assert!((ya - 2 * yb).abs() <= 2, "a held twice as long: {ya} vs {yb}");
}

/// Poking `accrue` every ledger cannot erase yield through rounding.
#[test]
fn frequent_accrual_does_not_lose_yield() {
    let t1 = setup(1_200);
    let t2 = setup(1_200);
    for t in [&t1, &t2] {
        let f = user(t, 100 * UNIT);
        t.c.fund_yield(&f, &(100 * UNIT));
    }
    // tiny eligible supply: per-ledger emission is < 1 stroop
    let a1 = user(&t1, 3 * UNIT);
    let a2 = user(&t2, 3 * UNIT);
    t1.c.deposit(&a1, &(3 * UNIT));
    t2.c.deposit(&a2, &(3 * UNIT));
    for _ in 0..720 {
        advance_secs(&t1.env, 5);
        t1.c.accrue();
    }
    advance_secs(&t2.env, 3_600);
    let y1 = t1.c.balance(&a1) - 3 * UNIT;
    let y2 = t2.c.balance(&a2) - 3 * UNIT;
    assert!(y2 > 0);
    assert!((y1 - y2).abs() <= 1, "poked {y1} vs untouched {y2}");
}

// ------------------------------------------------------------------ F-13

/// Regression F-13: the reserve commitment is bounded by `max_eligible`.
/// Above the cap, holders share the capped emission pro rata.
#[test]
fn regression_f13_eligible_supply_cap_bounds_emission() {
    let cap = 1_000 * UNIT;
    let t = setup_cap(1_000, cap); // 10% APR on at most 1,000 QFX
    let funder = user(&t, 1_000 * UNIT);
    t.c.fund_yield(&funder, &(1_000 * UNIT));
    let a = user(&t, 4_000 * UNIT);
    t.c.deposit(&a, &(4_000 * UNIT));
    let y = t.c.yield_info();
    assert_eq!(y.max_eligible, cap);
    assert_eq!(y.eligible_supply, 4_000 * UNIT);
    assert_eq!(y.effective_apr_bps, 250, "10% APR diluted 4x");
    assert_eq!(y.daily_emission, cap * 1_000 / (10_000 * 365));
    advance_days(&t.env, 1);
    let got = t.c.balance(&a) - 4_000 * UNIT;
    let capped = cap * 1_000 / (10_000 * 365); // what 1,000 QFX earn per day
    assert!((got - capped).abs() <= 2, "{got} vs {capped}");
    // the cap is only changed through the timelock
    let raise = QfxAction::SetMaxEligible(8_000 * UNIT);
    t.c.propose_action(&raise);
    assert_eq!(t.c.try_execute_action(&raise), Err(Ok(GovError::TimelockNotReady.into())));
    advance_secs(&t.env, DELAY);
    t.c.execute_action(&raise);
    assert_eq!(t.c.yield_info().effective_apr_bps, 1_000);
    // rejected when queued (and again on execution)
    let bad = QfxAction::SetMaxEligible(0);
    assert_eq!(t.c.try_propose_action(&bad), Err(Ok(TokenError::InvalidCap.into())));
    assert_peg(&t, &[&a]);
}

#[test]
fn runway_is_reported() {
    let t = setup(1_000);
    let funder = user(&t, 10 * UNIT);
    t.c.fund_yield(&funder, &(10 * UNIT));
    let a = user(&t, 365 * UNIT);
    t.c.deposit(&a, &(365 * UNIT));
    // 365 QFX at 10% = 0.1 QFX/day -> 10 QFX lasts 100 days
    let y = t.c.yield_info();
    let days = y.runway_seconds / DAY_SECONDS;
    assert!((99..=100).contains(&days), "runway {days} days");
}

// ------------------------------------------------------------------ governance / F-08

#[test]
fn pause_blocks_minting_but_not_exits() {
    let t = setup(1_000);
    let guardian = user(&t, 0);
    timelocked(&t, &QfxAction::SetGuardian(guardian.clone()));
    let a = user(&t, 100 * UNIT);
    let b = user(&t, 0);
    t.c.deposit(&a, &(50 * UNIT));
    t.c.pause(&guardian);
    assert!(t.c.paused());
    assert_eq!(t.c.try_deposit(&a, &UNIT), Err(Ok(GovError::Paused.into())));
    t.c.transfer(&a, &b, &UNIT);
    t.c.redeem(&a, &(10 * UNIT));
    t.c.burn(&b, &UNIT);
    t.c.settle(&a);
    t.env.set_auths(&[]);
    assert!(t.c.try_unpause().is_err(), "unpause needs the admin");
    t.env.mock_all_auths();
    t.c.unpause();
    t.c.deposit(&a, &UNIT);
    assert_peg(&t, &[&a, &b]);
}

#[test]
fn two_step_admin_replaces_set_admin() {
    let t = setup(1_000);
    let ms = user(&t, 0);
    t.c.propose_admin(&ms);
    assert_eq!(t.c.admin(), t.admin);
    t.c.accept_admin();
    assert_eq!(t.env.auths()[0].0, ms, "nominee must sign acceptance");
    assert_eq!(t.c.admin(), ms);
}

/// Regression F-08: the yield-exempt flag is re-bumped when read.
#[test]
fn regression_f08_exempt_entry_ttl_extended() {
    let t = setup(1_000);
    let staking = user(&t, 10 * UNIT);
    timelocked(&t, &QfxAction::SetYieldExempt(staking.clone(), true));
    let seq = t.env.ledger().sequence();
    t.env.ledger().set_sequence_number(
        seq + quasaria_gov::PERSISTENT_BUMP_TO - quasaria_gov::PERSISTENT_BUMP_THRESHOLD + 10,
    );
    t.c.deposit(&staking, &UNIT); // reads the exempt flag
    t.env.as_contract(&t.c.address, || {
        assert!(
            t.env.storage().persistent().get_ttl(&DataKey::Exempt(staking.clone()))
                >= quasaria_gov::PERSISTENT_BUMP_TO - 1
        );
        assert!(t.env.storage().instance().get_ttl() >= quasaria_gov::INSTANCE_BUMP_TO - 1);
    });
}

// ------------------------------------------------------------------ Step 1: timelocked setters

#[test]
fn step1_instant_setters_rejected() {
    let t = setup(1_000);
    let a = user(&t, 0);
    for (name, args) in [
        ("set_yield_exempt", (a.clone(), true).into_val(&t.env)),
        ("set_guardian", (a.clone(),).into_val(&t.env)),
    ] {
        let r = t.env.try_invoke_contract::<soroban_sdk::Val, soroban_sdk::InvokeError>(
            &t.c.address,
            &Symbol::new(&t.env, name),
            args,
        );
        assert!(r.is_err(), "instant `{name}` must not exist");
    }
    assert!(!t.c.is_yield_exempt(&a));
    assert_ne!(t.c.guardian(), a);
}

#[test]
fn step1_yield_exempt_queue_wait_execute() {
    let t = setup(1_000);
    let staking = user(&t, 10 * UNIT);
    t.c.deposit(&staking, &(10 * UNIT));
    let a = QfxAction::SetYieldExempt(staking.clone(), true);
    let eta = t.c.propose_action(&a);
    assert_eq!(eta, t.env.ledger().timestamp() + DELAY);
    assert_eq!(t.c.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
    assert!(!t.c.is_yield_exempt(&staking));
    assert_eq!(t.c.yield_info().eligible_supply, 10 * UNIT);
    advance_secs(&t.env, DELAY);
    t.c.execute_action(&a);
    assert!(t.c.is_yield_exempt(&staking));
    assert_eq!(t.c.yield_info().eligible_supply, 0);
}

#[test]
fn step1_guardian_cancels_yield_exempt_and_guardian_swap() {
    let t = setup(1_000);
    let g = user(&t, 0);
    timelocked(&t, &QfxAction::SetGuardian(g.clone()));
    let victim = user(&t, 0);
    let ex = QfxAction::SetYieldExempt(victim.clone(), true);
    let swap = QfxAction::SetGuardian(user(&t, 0));
    t.c.propose_action(&ex);
    t.c.propose_action(&swap);
    let rando = user(&t, 0);
    assert_eq!(t.c.try_cancel_action(&rando, &ex), Err(Ok(GovError::NotGuardian.into())));
    t.c.cancel_action(&g, &ex);
    t.c.cancel_action(&g, &swap);
    advance_secs(&t.env, DELAY);
    assert_eq!(t.c.try_execute_action(&ex), Err(Ok(GovError::NotQueued.into())));
    assert_eq!(t.c.try_execute_action(&swap), Err(Ok(GovError::NotQueued.into())));
    assert!(!t.c.is_yield_exempt(&victim));
    assert_eq!(t.c.guardian(), g);
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
    let xlm = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let mk = |d: u64| {
        env.register(
            QuasariaFlux,
            (
                &admin,
                &xlm,
                soroban_sdk::String::from_str(&env, "Quasaria Flux"),
                soroban_sdk::String::from_str(&env, "QFX"),
                1_000u32,
                10_000_000_000_000i128,
                d,
            ),
        )
    };
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        mk(DELAY);
    }));
    assert!(r.is_err(), "short delay rejected on mainnet");
    let c = QuasariaFluxClient::new(&env, &mk(48 * 3_600));
    let who = Address::generate(&env);
    assert_eq!(c.action_delay(&QfxAction::SetYieldExempt(who.clone(), true)), 48 * 3_600);
    assert_eq!(c.action_delay(&QfxAction::SetGuardian(who)), 48 * 3_600);
    assert_eq!(c.action_delay(&QfxAction::SetAprBps(100)), 48 * 3_600);
    assert_eq!(c.action_delay(&QfxAction::Upgrade(BytesN::from_array(&env, &[1; 32]))), 72 * 3_600);
    assert_eq!(c.action_delay(&QfxAction::SetDelay(60 * 3_600)), 72 * 3_600);
}
