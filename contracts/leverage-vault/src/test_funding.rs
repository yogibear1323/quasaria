#![cfg(test)]
//! Funding-module tests (perps draft). Own setup: no referral registry, so
//! every opening fee goes to the reserve and the accounting is exact.
extern crate std;

use super::*;
use quasaria_gov::GovError;
use quasaria_mock_oracle::{Asset as OAsset, MockOracle, MockOracleClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol,
};
use std::vec::Vec as SVec;

const P: i128 = 100_000_000_000_000; // 1.0 @ 14 dp
const U: i128 = 10_000_000; // 1 token @ 7 dp
const DELAY: u64 = 300;
const HOUR: u64 = 3_600;
const R: i128 = pricing::RATE_SCALE;

struct T {
    env: Env,
    v: LeverageVaultClient<'static>,
    oracle: MockOracleClient<'static>,
    tok: TokenClient<'static>,
    admin: Address,
}

fn vcfg() -> Config {
    Config {
        max_leverage_bps: 100_000, // 10x
        maintenance_margin_bps: 500,
        liquidation_bonus_bps: 500,
        open_fee_bps: 10,
        max_price_age: 600,
        min_margin: U,
        max_positions_per_user: 10,
        max_open_positions: 1_000,
    }
}

/// k = 1.0, skew_scale = 1,000 tokens, |premium| ≤ 1 %, |rate| ≤ 0.1 %/h.
fn fcfg() -> FundingConfig {
    FundingConfig {
        interval: HOUR,
        k: R,
        skew_scale: 1_000 * U,
        max_premium: R / 100,
        max_funding_rate_per_hour: R / 1_000,
        interest_per_interval: 0,
        max_catchup_intervals: 5,
    }
}

fn xlm(env: &Env) -> Asset {
    Asset::Other(Symbol::new(env, "XLM"))
}

fn base() -> T {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_timestamp(1_000_000);
    let admin = Address::generate(&env);
    let tok = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let oid = env.register(MockOracle, (&admin, 14u32, DELAY));
    let vid = env.register(LeverageVault, (&admin, &tok, &oid, None::<Address>, vcfg(), DELAY));
    let v = LeverageVaultClient::new(&env, &vid);
    v.set_market(&xlm(&env), &true);
    let oracle = MockOracleClient::new(&env, &oid);
    StellarAssetClient::new(&env, &tok).mint(&admin, &(1_000_000_000 * U));
    v.fund_liquidity(&admin, &(100_000 * U));
    let t = T { tok: TokenClient::new(&env, &tok), env, v, oracle, admin };
    price(&t, P);
    t
}

/// Vault with funding enabled through the timelock.
fn setup_with(f: FundingConfig) -> T {
    let t = base();
    timelocked(&t, &VaultAction::SetFundingDefault(f));
    t
}

fn setup() -> T {
    setup_with(fcfg())
}

fn price(t: &T, p: i128) {
    t.oracle.set_price(&OAsset::Other(Symbol::new(&t.env, "XLM")), &p, &0);
}

fn warp(t: &T, secs: u64) {
    let now = t.env.ledger().timestamp();
    t.env.ledger().set_timestamp(now + secs);
}

fn timelocked(t: &T, a: &VaultAction) {
    t.v.propose_action(a);
    warp(t, DELAY);
    t.v.execute_action(a);
    price(t, P);
}

fn trader(t: &T, amount: i128) -> Address {
    let u = Address::generate(&t.env);
    StellarAssetClient::new(&t.env, &t.tok.address).mint(&u, &amount);
    t.v.deposit(&u, &amount);
    u
}

fn open(t: &T, u: &Address, long: bool, margin: i128, lev_x: u32) -> u64 {
    t.v.open_position(u, u, &xlm(&t.env), &long, &margin, &(lev_x * 10_000))
}

/// Warp whole intervals, push a fresh price, update funding.
fn next_interval(t: &T, n: u64) -> i128 {
    warp(t, n * HOUR);
    price(t, P);
    t.v.update_funding(&xlm(&t.env))
}

/// The vault's token balance equals everything it owes.
fn assert_conserved(t: &T, users: &[Address]) {
    let mut owed = t.v.liquidity();
    for u in users {
        owed += t.v.free_collateral(u);
        for id in t.v.user_positions(u).iter() {
            owed += t.v.position(&id).margin;
        }
    }
    assert_eq!(t.tok.balance(&t.v.address), owed, "token balance == reserve + free + margins");
}

// ------------------------------------------------------------------ tests

#[test]
fn defaults_are_hourly_and_off() {
    let t = base();
    let c = t.v.funding_config(&xlm(&t.env));
    assert_eq!(c.interval, 3_600);
    assert_eq!((c.k, c.max_funding_rate_per_hour, c.interest_per_interval), (0, 0, 0));
    let u = trader(&t, 1_000 * U);
    open(&t, &u, true, 100 * U, 5);
    assert_eq!(next_interval(&t, 3), 0, "rates 0 → index never moves");
}

#[test]
fn rich_market_longs_pay_shorts() {
    let t = setup();
    let a = trader(&t, 1_000 * U);
    let b = trader(&t, 1_000 * U);
    let long = open(&t, &a, true, 100 * U, 5); // 500 notional
    let short = open(&t, &b, false, 50 * U, 2); // 100 notional
    // skew +400 tokens → premium clamp +1 % → mark above oracle (rich)
    assert!(t.v.mark_price(&xlm(&t.env)) > P);
    assert_eq!(t.v.mark_price(&xlm(&t.env)), P + P / 100);
    let idx = next_interval(&t, 1);
    assert_eq!(idx, R / 1_000, "rate = +0.1 % (capped) for one interval");
    assert_eq!(t.v.pending_funding(&long), 5 * U / 10, "long owes 0.1 % of 500");
    assert_eq!(t.v.pending_funding(&short), -(U / 10), "short receives 0.1 % of 100");
    let liq0 = t.v.liquidity();
    assert_eq!(t.v.close_position(&a, &long), 100 * U - 5 * U / 10);
    assert_eq!(t.v.close_position(&b, &short), 50 * U + U / 10);
    assert_eq!(t.v.liquidity() - liq0, 4 * U / 10, "imbalance (skew × rate) goes to the reserve");
    assert_conserved(&t, &[a, b]);
}

#[test]
fn cheap_market_shorts_pay_longs() {
    let t = setup();
    let a = trader(&t, 1_000 * U);
    let b = trader(&t, 1_000 * U);
    let long = open(&t, &a, true, 50 * U, 2); // 100
    let short = open(&t, &b, false, 100 * U, 5); // 500
    assert_eq!(t.v.mark_price(&xlm(&t.env)), P - P / 100, "mark below oracle (cheap)");
    assert_eq!(next_interval(&t, 1), -(R / 1_000));
    assert_eq!(t.v.pending_funding(&short), 5 * U / 10, "short pays");
    assert_eq!(t.v.pending_funding(&long), -(U / 10), "long receives");
    assert_eq!(t.v.close_position(&b, &short), 100 * U - 5 * U / 10);
    assert_eq!(t.v.close_position(&a, &long), 50 * U + U / 10);
    assert_conserved(&t, &[a, b]);
}

#[test]
fn no_op_within_an_interval() {
    let t = setup();
    let a = trader(&t, 1_000 * U);
    open(&t, &a, true, 100 * U, 5);
    let s0 = t.v.funding_state(&xlm(&t.env));
    warp(&t, HOUR - 1);
    price(&t, P);
    assert_eq!(t.v.update_funding(&xlm(&t.env)), 0);
    let s1 = t.v.funding_state(&xlm(&t.env));
    assert_eq!(s1.index, 0);
    assert_eq!(s1.last_funding_ts, s0.last_funding_ts, "boundary unchanged");
    assert!(s1.premium_acc > 0, "TWAP sample still accumulated");
    warp(&t, 1);
    price(&t, P);
    assert_eq!(t.v.update_funding(&xlm(&t.env)), R / 1_000, "advances exactly at the boundary");
    assert_eq!(t.v.funding_state(&xlm(&t.env)).last_funding_ts, s0.last_funding_ts + HOUR);
}

#[test]
fn multiple_missed_intervals_with_catchup_cap() {
    let t = setup();
    let a = trader(&t, 10_000 * U);
    let id = open(&t, &a, true, 1_000 * U, 2); // 2,000 notional, premium capped
    let start = t.v.funding_state(&xlm(&t.env)).last_funding_ts;
    warp(&t, 3 * HOUR + 100);
    price(&t, P);
    assert_eq!(t.v.update_funding(&xlm(&t.env)), 3 * (R / 1_000), "3 missed intervals charged");
    assert_eq!(t.v.funding_state(&xlm(&t.env)).last_funding_ts, start + 3 * HOUR, "cadence kept");
    // 10 more intervals, cap = 5: only 5 are charged, the boundary still moves 10
    assert_eq!(next_interval(&t, 10), 8 * (R / 1_000));
    assert_eq!(t.v.funding_state(&xlm(&t.env)).last_funding_ts, start + 13 * HOUR);
    assert_eq!(t.v.pending_funding(&id), 2_000 * U * 8 / 1_000);
}

#[test]
fn settles_on_increase_and_resets_entry() {
    let t = setup();
    let a = trader(&t, 1_000 * U);
    let id = open(&t, &a, true, 100 * U, 5);
    next_interval(&t, 1);
    let owed = t.v.pending_funding(&id);
    assert_eq!(owed, 5 * U / 10);
    let m0 = t.v.position(&id).margin;
    t.v.increase_position(&a, &id, &(10 * U), &(5 * 10_000));
    let p = t.v.position(&id);
    assert_eq!(p.margin, m0 - owed + 10 * U, "funding settled before the increase");
    assert_eq!(p.size, 550 * U);
    assert_eq!(t.v.pending_funding(&id), 0, "entry index reset");
    assert_eq!(t.v.funding_state(&xlm(&t.env)).long_oi, 550 * U, "OI follows the increase");
    assert_conserved(&t, &[a]);
}

#[test]
fn settles_on_decrease_and_trigger() {
    let t = setup();
    let a = trader(&t, 1_000 * U);
    let id = open(&t, &a, true, 100 * U, 5);
    next_interval(&t, 1);
    let owed = t.v.pending_funding(&id);
    t.v.decrease_position(&a, &id, &(250 * U));
    let p = t.v.position(&id);
    assert_eq!(p.size, 250 * U);
    assert_eq!(p.margin, (100 * U - owed) / 2 + (100 * U - owed) % 2, "half of the settled margin remains");
    assert_eq!(t.v.funding_state(&xlm(&t.env)).long_oi, 250 * U);
    next_interval(&t, 1);
    assert!(t.v.pending_funding(&id) > 0);
    t.v.set_triggers(&a, &id, &(P / 2), &(P + P / 100));
    price(&t, P + P / 50);
    let liq0 = t.v.liquidity();
    t.v.execute_trigger(&id);
    assert!(t.v.liquidity() < liq0, "profit paid net of funding");
    assert_eq!(t.v.funding_state(&xlm(&t.env)).long_oi, 0);
    assert_conserved(&t, &[a]);
}

#[test]
fn funding_driven_liquidation() {
    // |rate| up to 1 %/h so funding alone can drain a 10x position
    let mut f = fcfg();
    f.max_premium = R / 10;
    f.max_funding_rate_per_hour = R / 100;
    let t = setup_with(f);
    let a = trader(&t, 1_000 * U);
    let keeper = Address::generate(&t.env);
    let id = open(&t, &a, true, 100 * U, 10); // 1,000 notional, maint 50, HF 2.0
    assert_eq!(t.v.health_factor(&id), 20_000);
    next_interval(&t, 5); // 5 × 10 = 50 owed → equity 50 → HF 1.0
    assert_eq!(t.v.health_factor(&id), 10_000);
    assert_eq!(t.v.try_liquidate(&keeper, &id), Err(Ok(VaultError::Healthy.into())));
    // one more hour, NOT yet applied to the index: the view projects it
    warp(&t, HOUR);
    price(&t, P);
    assert_eq!(t.v.funding_state(&xlm(&t.env)).index, 5 * (R / 100), "index not yet advanced");
    assert!(t.v.health_factor(&id) < 10_000, "HF counts unsettled funding");
    let liq0 = t.v.liquidity();
    let bonus = t.v.liquidate(&keeper, &id);
    // funding (60) is settled first, so the bonus is 5 % of the settled
    // margin (40) = 2, and the trader keeps equity − bonus = 38
    assert_eq!(bonus, 2 * U);
    assert_eq!(t.tok.balance(&keeper), 2 * U);
    assert_eq!(t.v.liquidity() - liq0, 60 * U, "reserve received the funding");
    assert_eq!(t.v.free_collateral(&a), 1_000 * U - 100 * U - U + 38 * U);
    assert_eq!(t.v.funding_state(&xlm(&t.env)).long_oi, 0);
    assert_conserved(&t, &[a]);
}

#[test]
fn stale_oracle_blocks_update_and_index_holds() {
    let t = setup();
    let a = trader(&t, 1_000 * U);
    let id = open(&t, &a, true, 100 * U, 5);
    warp(&t, HOUR); // no fresh price: last one is an hour old (> 600 s)
    assert_eq!(t.v.try_update_funding(&xlm(&t.env)), Err(Ok(VaultError::StalePrice.into())));
    assert_eq!(t.v.try_close_position(&a, &id), Err(Ok(VaultError::StalePrice.into())));
    assert_eq!(t.v.funding_state(&xlm(&t.env)).index, 0, "index did not move");
    price(&t, P);
    assert_eq!(t.v.update_funding(&xlm(&t.env)), R / 1_000, "catches up once fresh");
}

#[test]
fn accrues_while_paused_and_closes_still_work() {
    let t = setup();
    let a = trader(&t, 1_000 * U);
    let id = open(&t, &a, true, 100 * U, 5);
    t.v.pause(&t.admin);
    assert_eq!(next_interval(&t, 1), R / 1_000, "funding accrues while paused");
    assert_eq!(
        t.v.try_increase_position(&a, &id, &U, &20_000),
        Err(Ok(GovError::Paused.into()))
    );
    assert_eq!(t.v.close_position(&a, &id), 100 * U - 5 * U / 10, "close settles funding while paused");
}

#[test]
fn balanced_book_rounding_never_pays_out() {
    // interest-only funding on a balanced book with sizes that never divide
    // evenly: the payer rounds up, the receiver down, the reserve never loses
    let mut f = fcfg();
    f.max_funding_rate_per_hour = R / 500;
    f.interest_per_interval = R / 1_000 + 7; // 0.1 % + dust
    let t = setup_with(f);
    let a = trader(&t, 1_000 * U);
    let b = trader(&t, 1_000 * U);
    let l = open(&t, &a, true, 33 * U + 3, 3);
    let s = open(&t, &b, false, 33 * U + 3, 3);
    let (ml, ms) = (t.v.position(&l).margin, t.v.position(&s).margin);
    let liq0 = t.v.liquidity();
    for _ in 0..7 {
        next_interval(&t, 1);
        // touch both every interval: rounding happens on every settlement
        t.v.increase_position(&a, &l, &U, &10_000);
        t.v.increase_position(&b, &s, &U, &10_000);
    }
    let pl = t.v.close_position(&a, &l);
    let ps = t.v.close_position(&b, &s);
    let paid_in = (ml + 7 * U) + (ms + 7 * U);
    assert!(pl + ps <= paid_in, "traders never get back more than they put in at a flat price");
    // fees (7 increases each) + net funding ≥ fees alone
    let fees = 2 * 7 * (U / 1_000);
    assert!(t.v.liquidity() - liq0 >= fees, "reserve never pays funding net on a balanced book");
    assert!(pl < ml + 7 * U && ps > ms + 7 * U, "long paid, short received");
    assert_conserved(&t, &[a, b]);
}

#[test]
fn property_random_walk_conserves_value() {
    // Deterministic pseudo-random sequence of every touch with funding on
    // (interest dust forces rounding). After each step the vault holds
    // exactly what it owes, and at the end nobody got out more than the
    // tokens that came in.
    let mut f = fcfg();
    f.interest_per_interval = 13;
    f.max_premium = R / 50;
    f.max_funding_rate_per_hour = R / 200;
    let t = setup_with(f);
    let keeper = Address::generate(&t.env);
    let mut seed: u64 = 0x5eed_1234;
    let mut rnd = |m: u64| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) % m
    };
    let users: SVec<Address> = (0..6).map(|_| trader(&t, 5_000 * U + 17)).collect();
    let total_in = t.tok.balance(&t.v.address);
    let mut px = P;
    let mut ok = [0u32; 6]; // open, increase, decrease, close, update, liquidate
    for _step in 0..160 {
        let u = &users[rnd(users.len() as u64) as usize];
        let ids: SVec<u64> = t.v.user_positions(u).iter().collect();
        match rnd(7) {
            0 | 1 => {
                let m = (U + 1) + (rnd(200) as i128) * U + rnd(997) as i128;
                ok[0] += t.v.try_open_position(u, u, &xlm(&t.env), &(rnd(2) == 0), &m, &(10_000 + rnd(90_000) as u32)).is_ok() as u32;
            }
            2 if !ids.is_empty() => {
                ok[1] += t.v.try_increase_position(u, &ids[0], &(U + rnd(50) as i128 * U + 3), &(10_000 + rnd(40_000) as u32)).is_ok() as u32;
            }
            3 if !ids.is_empty() => {
                let sz = t.v.position(&ids[0]).size;
                ok[2] += t.v.try_decrease_position(u, &ids[0], &(sz / (2 + rnd(3) as i128))).is_ok() as u32;
            }
            4 if !ids.is_empty() => {
                ok[3] += t.v.try_close_position(u, &ids[0]).is_ok() as u32;
            }
            5 => {
                warp(&t, 600 + rnd(2 * HOUR));
                // ±3 % walk
                px = px + px * (rnd(61) as i128 - 30) / 1_000;
                price(&t, px);
                ok[4] += t.v.try_update_funding(&xlm(&t.env)).is_ok() as u32;
            }
            _ => {
                for u2 in users.iter() {
                    for id in t.v.user_positions(u2).iter() {
                        ok[5] += t.v.try_liquidate(&keeper, &id).is_ok() as u32;
                    }
                }
            }
        }
        // keeper bonuses leave the vault: count them as owed-and-paid
        let out = t.tok.balance(&keeper);
        let mut owed = t.v.liquidity() + out;
        for u2 in users.iter() {
            owed += t.v.free_collateral(u2);
            for id in t.v.user_positions(u2).iter() {
                owed += t.v.position(&id).margin;
            }
        }
        assert_eq!(t.tok.balance(&t.v.address) + out, owed);
        assert_eq!(t.tok.balance(&t.v.address) + out, total_in, "no value created or lost");
    }
    std::println!("random walk successes [open, increase, decrease, close, update, liquidate] = {ok:?}, index = {}", t.v.funding_state(&xlm(&t.env)).index);
    assert!(ok[0] >= 10 && ok[1] >= 3 && ok[2] >= 3 && ok[3] >= 3 && ok[4] >= 5, "every path exercised: {ok:?}");
    assert_ne!(t.v.funding_state(&xlm(&t.env)).index, 0, "funding actually moved");
    // close everything at the last price and check OI returns to zero
    price(&t, px);
    for u in users.iter() {
        for id in t.v.user_positions(u).iter() {
            t.v.close_position(u, &id);
        }
    }
    let st = t.v.funding_state(&xlm(&t.env));
    assert_eq!((st.long_oi, st.short_oi), (0, 0), "OI fully released");
    assert_conserved(&t, &users);
}

#[test]
fn funding_params_go_through_the_timelock() {
    let t = base();
    let f = fcfg();
    let a = VaultAction::SetFundingDefault(f.clone());
    t.v.propose_action(&a);
    assert_eq!(t.v.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
    assert_eq!(t.v.funding_config(&xlm(&t.env)).k, 0, "unchanged before the delay");
    warp(&t, DELAY);
    t.v.execute_action(&a);
    assert_eq!(t.v.funding_config(&xlm(&t.env)), f);
    // per-market override, e.g. a 2 h interval
    let mut g = f.clone();
    g.interval = 7_200;
    timelocked(&t, &VaultAction::SetMarketFunding(xlm(&t.env), g.clone()));
    assert_eq!(t.v.funding_config(&xlm(&t.env)), g);
    // invalid configs are refused when queued
    for bad in [
        FundingConfig { interval: 59, ..f.clone() },
        FundingConfig { max_funding_rate_per_hour: R / 50, ..f.clone() },
        FundingConfig { max_premium: R, ..f.clone() },
        FundingConfig { skew_scale: 0, ..f.clone() },
        FundingConfig { max_catchup_intervals: 0, ..f.clone() },
        FundingConfig { interest_per_interval: R / 100, ..f.clone() },
    ] {
        assert_eq!(
            t.v.try_propose_action(&VaultAction::SetFundingDefault(bad)),
            Err(Ok(VaultError::InvalidConfig.into()))
        );
    }
    // the guardian/admin can cancel a queued change
    let c = VaultAction::SetFundingDefault(FundingConfig { k: 2 * R, ..f.clone() });
    t.v.propose_action(&c);
    t.v.cancel_action(&t.admin, &c);
    warp(&t, DELAY);
    assert_eq!(t.v.try_execute_action(&c), Err(Ok(GovError::NotQueued.into())));
    // only the admin can queue
    t.env.set_auths(&[]);
    assert!(t.v.try_propose_action(&VaultAction::SetFundingDefault(f)).is_err());
}

#[test]
fn update_funding_unknown_market_rejected() {
    let t = setup();
    let doge = Asset::Other(Symbol::new(&t.env, "DOGE"));
    assert_eq!(t.v.try_update_funding(&doge), Err(Ok(VaultError::MarketNotEnabled.into())));
}
