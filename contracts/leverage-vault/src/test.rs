#![cfg(test)]
extern crate std;

use super::*;
use quasaria_gov::{GovError, GRACE_PERIOD};
use quasaria_mock_oracle::{Asset as OAsset, MockOracle, MockOracleClient};
use quasaria_referral::{ReferralRegistry, ReferralRegistryClient};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Symbol,
};

const P: i128 = 100_000_000_000_000; // 1.0 with 14 decimals
const DELAY: u64 = 3_600;
const MIN_MARGIN: i128 = 10_000_000; // 1 unit at 7 decimals

struct T {
    env: Env,
    v: LeverageVaultClient<'static>,
    oracle: MockOracleClient<'static>,
    usdc: TokenClient<'static>,
    reg: ReferralRegistryClient<'static>,
    admin: Address,
}

fn config() -> Config {
    Config {
        max_leverage_bps: 100_000,   // 10x
        maintenance_margin_bps: 500, // 5%
        liquidation_bonus_bps: 500,  // 5% of margin
        open_fee_bps: 10,            // 0.1% of notional
        max_price_age: 600,
        min_margin: MIN_MARGIN,
        max_positions_per_user: 10,
        max_open_positions: 1_000,
    }
}

fn setup_with(c: Config) -> T {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_timestamp(1_000_000 - DELAY);
    let admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let oracle_id = env.register(MockOracle, (&admin, 14u32, DELAY));
    let reg_id = env.register(ReferralRegistry, (&admin, 2_000u32, DELAY));
    let vid = env.register(
        LeverageVault,
        (&admin, &usdc, &oracle_id, Some(reg_id.clone()), c, DELAY),
    );
    let reg = ReferralRegistryClient::new(&env, &reg_id);
    let fs = quasaria_referral::ReferralAction::SetFeeSource(vid.clone(), true);
    reg.propose_action(&fs);
    env.ledger().set_timestamp(1_000_000);
    reg.execute_action(&fs);
    let v = LeverageVaultClient::new(&env, &vid);
    v.set_market(&Asset::Other(Symbol::new(&env, "XLM")), &true);
    let oracle = MockOracleClient::new(&env, &oracle_id);
    oracle.set_price(&OAsset::Other(Symbol::new(&env, "XLM")), &P, &0);
    StellarAssetClient::new(&env, &usdc).mint(&admin, &1_000_000_000_000);
    v.fund_liquidity(&admin, &100_000_000_000);
    T {
        usdc: TokenClient::new(&env, &usdc),
        env,
        v,
        oracle,
        reg,
        admin,
    }
}

fn setup() -> T {
    setup_with(config())
}

fn xlm(env: &Env) -> Asset {
    Asset::Other(Symbol::new(env, "XLM"))
}

fn set_price(t: &T, p: i128) {
    t.oracle
        .set_price(&OAsset::Other(Symbol::new(&t.env, "XLM")), &p, &0);
}

fn trader(t: &T, amount: i128) -> Address {
    let u = Address::generate(&t.env);
    StellarAssetClient::new(&t.env, &t.usdc.address).mint(&u, &amount);
    t.v.deposit(&u, &amount);
    u
}

fn warp(t: &T, secs: u64) {
    let now = t.env.ledger().timestamp();
    t.env.ledger().set_timestamp(now + secs);
}

/// Queue, wait out the delay, and execute a timelocked action.
fn timelocked(t: &T, a: &VaultAction) {
    t.v.propose_action(a);
    warp(t, DELAY);
    set_price(t, current_price(t));
    t.v.execute_action(a);
}

fn current_price(t: &T) -> i128 {
    t.oracle
        .lastprice(&OAsset::Other(Symbol::new(&t.env, "XLM")))
        .unwrap()
        .price
}

#[test]
fn long_profit_and_short_loss() {
    let t = setup();
    let u = trader(&t, 2_000_000_000);
    // 100 USDC margin, 5x long -> 500 notional, fee 0.5
    let id = t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &50_000);
    assert_eq!(t.v.free_collateral(&u), 2_000_000_000 - 1_000_000_000 - 5_000_000);
    set_price(&t, P * 110 / 100); // +10% -> pnl = +50
    let payout = t.v.close_position(&u, &id);
    assert_eq!(payout, 1_000_000_000 + 500_000_000);
    // short loses when price rises
    let id2 = t.v.open_position(&u, &u, &xlm(&t.env), &false, &1_000_000_000, &20_000);
    set_price(&t, P * 121 / 100); // +10% from 1.10
    let payout2 = t.v.close_position(&u, &id2);
    assert_eq!(payout2, 1_000_000_000 - 200_000_000);
    // withdraw everything
    let free = t.v.free_collateral(&u);
    t.v.withdraw(&u, &free);
    assert_eq!(t.usdc.balance(&u), free);
}

#[test]
fn leverage_cap_enforced() {
    let t = setup();
    let u = trader(&t, 1_000_000_000);
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &100_000_000, &100_001),
        Err(Ok(VaultError::LeverageTooHigh.into()))
    );
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &100_000_000, &9_999),
        Err(Ok(VaultError::LeverageTooLow.into()))
    );
    // admin cannot exceed hard cap (rejected when the timelocked action is
    // queued, and again on execution)
    let mut c = config();
    c.max_leverage_bps = HARD_MAX_LEVERAGE_BPS + 1;
    let a = VaultAction::SetConfig(c);
    assert_eq!(t.v.try_propose_action(&a), Err(Ok(VaultError::InvalidConfig.into())));
}

#[test]
fn liquidation_by_health_factor() {
    let t = setup();
    let u = trader(&t, 2_000_000_000);
    let keeper = Address::generate(&t.env);
    // 10x long: 100 margin, 1000 notional. Maint = 50. Liq when equity < 50
    let id = t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &100_000);
    let liq_price = t.v.liquidation_price(&id);
    assert_eq!(liq_price, P * 95 / 100);
    assert!(t.v.health_factor(&id) > BPS);
    assert_eq!(t.v.try_liquidate(&keeper, &id), Err(Ok(VaultError::Healthy.into())));
    set_price(&t, P * 94 / 100); // -6% -> equity = 1000M - 600M = 400M; maint 500M
    assert!(t.v.health_factor(&id) < BPS);
    let bonus = t.v.liquidate(&keeper, &id);
    assert_eq!(bonus, 50_000_000); // 5% of 1000M margin
    assert_eq!(t.usdc.balance(&keeper), 50_000_000);
    assert_eq!(t.v.open_position_count(), 0);
    assert_eq!(t.v.open_position_ids().len(), 0);
    assert_eq!(t.v.try_position(&id), Err(Ok(VaultError::PositionNotFound.into())));
}

#[test]
fn operator_can_trade_and_keeper_executes_triggers() {
    let t = setup();
    let u = trader(&t, 1_000_000_000);
    let bot = Address::generate(&t.env);
    assert_eq!(
        t.v.try_open_position(&bot, &u, &xlm(&t.env), &true, &100_000_000, &20_000),
        Err(Ok(VaultError::NotAuthorized.into()))
    );
    t.v.set_operator(&u, &Some(bot.clone()));
    assert_eq!(t.v.operator(&u), Some(bot.clone()));
    let id = t.v.open_position(&bot, &u, &xlm(&t.env), &true, &100_000_000, &20_000);
    t.v.set_triggers(&bot, &id, &(P * 90 / 100), &(P * 120 / 100));
    // take profit hit -> any keeper can execute
    assert_eq!(t.v.try_execute_trigger(&id), Err(Ok(VaultError::TriggerNotHit.into())));
    set_price(&t, P * 125 / 100);
    let payout = t.v.execute_trigger(&id);
    assert_eq!(payout, 100_000_000 + 50_000_000);
    assert_eq!(t.v.user_positions(&u).len(), 0);
    // stop loss on a short
    let id2 = t.v.open_position(&bot, &u, &xlm(&t.env), &false, &100_000_000, &20_000);
    t.v.set_triggers(&u, &id2, &(P * 130 / 100), &0);
    set_price(&t, P * 131 / 100);
    t.v.execute_trigger(&id2);
    t.v.set_operator(&u, &None);
    assert_eq!(t.v.operator(&u), None);
}

#[test]
fn stale_oracle_rejected_and_profit_capped_by_reserve() {
    let t = setup();
    let u = trader(&t, 10_000_000_000);
    warp(&t, 601);
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &100_000_000, &20_000),
        Err(Ok(VaultError::StalePrice.into()))
    );
    set_price(&t, P);
    let keep = 10_000_000;
    timelocked(&t, &VaultAction::WithdrawLiquidity(t.admin.clone(), t.v.liquidity() - keep));
    let id = t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &100_000);
    let reserve = t.v.liquidity();
    set_price(&t, P * 2); // huge profit, capped by reserve
    let payout = t.v.close_position(&u, &id);
    assert_eq!(payout, 1_000_000_000 + reserve);
    assert_eq!(t.v.liquidity(), 0);
}

#[test]
fn referrer_earns_share_of_open_fee() {
    let t = setup();
    let referrer = Address::generate(&t.env);
    let u = Address::generate(&t.env);
    t.reg.set_referrer(&u, &referrer);
    StellarAssetClient::new(&t.env, &t.usdc.address).mint(&u, &2_000_000_000);
    t.v.deposit(&u, &2_000_000_000);
    t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &100_000);
    // notional 10_000M, fee 10M, referral 20% = 2M
    assert_eq!(t.v.free_collateral(&referrer), 2_000_000);
    assert_eq!(t.reg.earned(&referrer, &t.usdc.address), 2_000_000);
}

#[test]
fn pure_math() {
    let env = Env::default();
    assert_eq!(pnl_at(&env, true, 1_000, 100, 110), 100);
    assert_eq!(pnl_at(&env, false, 1_000, 100, 110), -100);
    assert_eq!(health_factor_bps(&env, 100, 1_000, -60, 500), 8_000);
    assert_eq!(health_factor_bps(&env, 100, 1_000, -200, 500), 0);
    // tiny size: maintenance floors at 1 unit, so HF is finite
    assert_eq!(health_factor_bps(&env, 1, 10, 0, 500), BPS);
    // large values do not overflow (256-bit intermediate)
    assert_eq!(pnl_at(&env, true, i128::MAX / 4, P, P * 2), i128::MAX / 4);
}

// ------------------------------------------------------------------ F-02

/// Regression F-02: a 1-stroop "dust" position used to be accepted with a
/// zero fee and zero maintenance (HF = i128::MAX, never liquidatable).
#[test]
fn regression_f02_dust_position_rejected() {
    let t = setup();
    let attacker = trader(&t, 10_000);
    assert_eq!(
        t.v.try_open_position(&attacker, &attacker, &xlm(&t.env), &true, &1, &100_000),
        Err(Ok(VaultError::BelowMinMargin.into()))
    );
    assert_eq!(
        t.v.try_open_position(&attacker, &attacker, &xlm(&t.env), &true, &(MIN_MARGIN - 1), &100_000),
        Err(Ok(VaultError::BelowMinMargin.into()))
    );
    assert_eq!(t.v.open_position_count(), 0);
}

/// Regression F-02: the smallest allowed position pays a fee and can be
/// liquidated.
#[test]
fn regression_f02_min_position_pays_fee_and_is_liquidatable() {
    let t = setup();
    let u = trader(&t, 1_000_000_000);
    let keeper = Address::generate(&t.env);
    let before = t.v.free_collateral(&u);
    let id = t.v.open_position(&u, &u, &xlm(&t.env), &true, &MIN_MARGIN, &10_000);
    assert!(before - t.v.free_collateral(&u) > MIN_MARGIN, "fee must be > 0");
    assert!(t.v.health_factor(&id) < i128::MAX);
    set_price(&t, P * 4 / 100); // -96% -> equity 4% < maint 5%
    assert!(t.v.health_factor(&id) < BPS);
    t.v.liquidate(&keeper, &id);
    assert_eq!(t.v.open_position_count(), 0);
}

/// Regression F-02: per-user and global caps on open positions.
#[test]
fn regression_f02_user_and_global_position_caps() {
    let mut c = config();
    c.max_positions_per_user = 3;
    c.max_open_positions = 5;
    let t = setup_with(c);
    let a = trader(&t, 10_000_000_000);
    let b = trader(&t, 10_000_000_000);
    let mut ids = std::vec::Vec::new();
    for _ in 0..3 {
        ids.push(t.v.open_position(&a, &a, &xlm(&t.env), &true, &MIN_MARGIN, &20_000));
    }
    assert_eq!(
        t.v.try_open_position(&a, &a, &xlm(&t.env), &true, &MIN_MARGIN, &20_000),
        Err(Ok(VaultError::TooManyUserPositions.into()))
    );
    t.v.open_position(&b, &b, &xlm(&t.env), &true, &MIN_MARGIN, &20_000);
    t.v.open_position(&b, &b, &xlm(&t.env), &true, &MIN_MARGIN, &20_000);
    let c3 = trader(&t, 10_000_000_000);
    assert_eq!(
        t.v.try_open_position(&c3, &c3, &xlm(&t.env), &true, &MIN_MARGIN, &20_000),
        Err(Ok(VaultError::TooManyOpenPositions.into()))
    );
    // closing frees a slot (global and per-user)
    t.v.close_position(&a, &ids[1]);
    t.v.open_position(&c3, &c3, &xlm(&t.env), &true, &MIN_MARGIN, &20_000);
    assert_eq!(t.v.open_position_count(), 5);
    assert_eq!(t.v.user_positions(&a).len(), 2);
}

/// Regression F-02: storage is per position (dense slot index), so an honest
/// open writes the same number of bytes with 1 or 500 positions open (the old
/// code rewrote one global `OpenIds` vector that grew 12 bytes per position),
/// and the open-position index stays consistent under swap-remove.
#[test]
fn regression_f02_bounded_storage_and_constant_cost() {
    let t = setup();
    let honest = trader(&t, 10_000_000_000);
    t.v.open_position(&honest, &honest, &xlm(&t.env), &true, &1_000_000_000, &20_000);
    let r_empty = t.env.cost_estimate().resources();

    let mut all = std::vec::Vec::new();
    for _ in 0..50 {
        let u = trader(&t, 1_000_000_000);
        for _ in 0..10 {
            all.push(t.v.open_position(&u, &u, &xlm(&t.env), &true, &MIN_MARGIN, &20_000));
        }
    }
    assert_eq!(t.v.open_position_count(), 501);
    t.v.open_position(&honest, &honest, &xlm(&t.env), &true, &1_000_000_000, &20_000);
    let r_full = t.env.cost_estimate().resources();
    std::println!(
        "F-02 regression: honest open with 1 open: write_bytes={} entries_read={} instr={}; with 501 open: write_bytes={} entries_read={} instr={}",
        r_empty.write_bytes, r_empty.memory_read_entries, r_empty.instructions,
        r_full.write_bytes, r_full.memory_read_entries, r_full.instructions
    );
    // (`instructions` in the unit-test host also grows with the *total* number
    // of ledger entries in the test Env, even unrelated ones such as token
    // balances, so bytes/entries are the meaningful metric here.)
    // The honest user's own list grew by one id (+12 bytes); nothing else may grow.
    assert!(r_full.write_bytes <= r_empty.write_bytes + 16, "write size must not grow with position count");
    assert!(r_full.memory_read_entries <= r_empty.memory_read_entries);

    // remove a few from the middle and check the paged index == live set
    for id in [all[3], all[100], all[250], all[499]] {
        let owner = t.v.position(&id).owner;
        t.v.close_position(&owner, &id);
    }
    let n = t.v.open_position_count();
    assert_eq!(n, 498);
    let mut seen = std::collections::BTreeSet::new();
    let mut start = 0u32;
    while start < n {
        let page = t.v.open_position_ids_page(&start, &MAX_PAGE);
        assert!(page.len() <= MAX_PAGE);
        for id in page.iter() {
            t.v.position(&id); // exists
            assert!(seen.insert(id), "duplicate id in index");
        }
        start += MAX_PAGE;
    }
    assert_eq!(seen.len() as u32, n);
    assert_eq!(t.v.open_position_ids().len(), MAX_PAGE);
}

// ------------------------------------------------------------------ F-07

/// Regression F-07: a price dated in the future (beyond clock skew) is rejected.
#[test]
fn regression_f07_future_oracle_timestamp_rejected() {
    let t = setup();
    let u = trader(&t, 20_000_000_000);
    let now = t.env.ledger().timestamp();
    t.oracle.set_price(&OAsset::Other(Symbol::new(&t.env, "XLM")), &P, &(now + 30 * 86_400));
    t.env.ledger().set_timestamp(now + 20 * 86_400);
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &50_000),
        Err(Ok(VaultError::FuturePrice.into()))
    );
    // small skew is tolerated
    let now = t.env.ledger().timestamp();
    t.oracle.set_price(&OAsset::Other(Symbol::new(&t.env, "XLM")), &P, &(now + MAX_FUTURE_SKEW));
    t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &50_000);
    t.oracle.set_price(&OAsset::Other(Symbol::new(&t.env, "XLM")), &P, &(now + MAX_FUTURE_SKEW + 1));
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &50_000),
        Err(Ok(VaultError::FuturePrice.into()))
    );
}

/// Regression F-07: staleness is enforced and the admin cannot configure an
/// unbounded max age.
#[test]
fn regression_f07_max_staleness_enforced() {
    let t = setup();
    let u = trader(&t, 20_000_000_000);
    warp(&t, 600);
    t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &50_000); // exactly max age: ok
    warp(&t, 1);
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &50_000),
        Err(Ok(VaultError::StalePrice.into()))
    );
    for bad_age in [0u64, HARD_MAX_PRICE_AGE + 1, u64::MAX] {
        let mut c = config();
        c.max_price_age = bad_age;
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(
                LeverageVault,
                (&admin, &admin, &admin, None::<Address>, c.clone(), DELAY),
            )
        }));
        assert!(r.is_err(), "max_price_age {bad_age} must be rejected");
    }
}

#[test]
fn invalid_configs_rejected() {
    let t = setup();
    let mut bad = std::vec::Vec::new();
    let mut c = config();
    c.min_margin = MIN_MARGIN_FLOOR - 1;
    bad.push(c);
    let mut c = config();
    c.max_positions_per_user = HARD_MAX_POSITIONS_PER_USER + 1;
    bad.push(c);
    let mut c = config();
    c.max_open_positions = 0;
    bad.push(c);
    let mut c = config();
    c.maintenance_margin_bps = 1_000; // >= initial margin at 10x
    bad.push(c);
    for c in bad {
        let a = VaultAction::SetConfig(c);
        assert_eq!(t.v.try_propose_action(&a), Err(Ok(VaultError::InvalidConfig.into())));
    }
}

// ------------------------------------------------------------------ F-01 / governance

#[test]
fn timelock_guards_reserve_withdrawal() {
    let t = setup();
    let liq = t.v.liquidity();
    let a = VaultAction::WithdrawLiquidity(t.admin.clone(), liq);
    // not queued
    assert_eq!(t.v.try_execute_action(&a), Err(Ok(GovError::NotQueued.into())));
    let eta = t.v.propose_action(&a);
    assert_eq!(eta, t.env.ledger().timestamp() + DELAY);
    assert_eq!(t.v.action_eta(&a), Some(eta));
    assert_eq!(t.v.try_propose_action(&a), Err(Ok(GovError::AlreadyQueued.into())));
    // early execution rejected
    warp(&t, DELAY - 1);
    assert_eq!(t.v.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
    assert_eq!(t.v.liquidity(), liq);
    warp(&t, 1);
    let before = t.usdc.balance(&t.admin);
    t.v.execute_action(&a);
    assert_eq!(t.v.liquidity(), 0);
    assert_eq!(t.usdc.balance(&t.admin), before + liq);
    // one-shot
    assert_eq!(t.v.try_execute_action(&a), Err(Ok(GovError::NotQueued.into())));
}

#[test]
fn timelock_cancel_and_expiry() {
    let t = setup();
    let guardian = Address::generate(&t.env);
    timelocked(&t, &VaultAction::SetGuardian(guardian.clone()));
    let evil_oracle = Address::generate(&t.env);
    let a = VaultAction::SetOracle(evil_oracle.clone());
    t.v.propose_action(&a);
    // a random account cannot cancel, the guardian can
    let rando = Address::generate(&t.env);
    assert_eq!(t.v.try_cancel_action(&rando, &a), Err(Ok(GovError::NotGuardian.into())));
    t.v.cancel_action(&guardian, &a);
    warp(&t, DELAY);
    assert_eq!(t.v.try_execute_action(&a), Err(Ok(GovError::NotQueued.into())));
    assert_ne!(t.v.oracle(), evil_oracle);
    // expired after the grace period
    t.v.propose_action(&a);
    warp(&t, DELAY + GRACE_PERIOD + 1);
    assert_eq!(t.v.try_execute_action(&a), Err(Ok(GovError::TimelockExpired.into())));
    t.v.cancel_action(&t.admin, &a);
    // happy path
    t.v.propose_action(&a);
    warp(&t, DELAY);
    t.v.execute_action(&a);
    assert_eq!(t.v.oracle(), evil_oracle);
}

#[test]
fn timelock_delay_change_and_upgrade_are_timelocked() {
    let t = setup();
    assert_eq!(t.v.timelock_delay(), DELAY);
    let a = VaultAction::SetDelay(7_200);
    t.v.propose_action(&a);
    assert_eq!(t.v.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
    warp(&t, DELAY);
    t.v.execute_action(&a);
    assert_eq!(t.v.timelock_delay(), 7_200);
    // invalid delay rejected when queued
    let bad = VaultAction::SetDelay(1);
    assert_eq!(t.v.try_propose_action(&bad), Err(Ok(GovError::InvalidDelay.into())));
    // upgrade: early execution rejected by the timelock
    let up = VaultAction::Upgrade(BytesN::from_array(&t.env, &[7u8; 32]));
    t.v.propose_action(&up);
    assert_eq!(t.v.try_execute_action(&up), Err(Ok(GovError::TimelockNotReady.into())));
    // after the delay the timelock lets it through and the host rejects the
    // unknown wasm hash (so the only gate in front of an upgrade is the timelock)
    warp(&t, 7_200);
    let r = t.v.try_execute_action(&up);
    assert!(r.is_err());
    assert_ne!(r, Err(Ok(GovError::TimelockNotReady.into())));
    assert_ne!(r, Err(Ok(GovError::NotQueued.into())));
}

#[test]
fn pause_blocks_new_risk_but_not_exits() {
    let t = setup();
    let guardian = Address::generate(&t.env);
    timelocked(&t, &VaultAction::SetGuardian(guardian.clone()));
    assert_eq!(t.v.guardian(), guardian);
    let u = trader(&t, 2_000_000_000);
    let keeper = Address::generate(&t.env);
    let long = t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &100_000);
    let tp = t.v.open_position(&u, &u, &xlm(&t.env), &false, &100_000_000, &20_000);
    let short = t.v.open_position(&u, &u, &xlm(&t.env), &false, &100_000_000, &20_000);
    let rando = Address::generate(&t.env);
    assert_eq!(t.v.try_pause(&rando), Err(Ok(GovError::NotGuardian.into())));
    t.v.pause(&guardian);
    assert!(t.v.paused());
    // new risk blocked
    assert_eq!(t.v.try_deposit(&u, &1), Err(Ok(GovError::Paused.into())));
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &100_000_000, &20_000),
        Err(Ok(GovError::Paused.into()))
    );
    // exits still work: triggers, keeper, liquidation, close, withdraw
    t.v.set_triggers(&u, &tp, &0, &(P * 99 / 100));
    set_price(&t, P * 94 / 100);
    t.v.execute_trigger(&tp);
    t.v.liquidate(&keeper, &long);
    t.v.close_position(&u, &short);
    let free = t.v.free_collateral(&u);
    t.v.withdraw(&u, &free);
    // guardian cannot unpause (admin only)
    t.env.set_auths(&[]);
    assert!(t.v.try_unpause().is_err());
    t.env.mock_all_auths();
    t.v.unpause();
    assert!(!t.v.paused());
    t.v.deposit(&t.admin, &1);
}

#[test]
fn two_step_admin_transfer() {
    let t = setup();
    let multisig = Address::generate(&t.env);
    assert_eq!(t.v.try_accept_admin(), Err(Ok(GovError::NoPendingAdmin.into())));
    t.v.propose_admin(&multisig);
    assert_eq!(t.v.pending_admin(), Some(multisig.clone()));
    assert_eq!(t.v.admin(), t.admin); // unchanged until accepted
    t.v.accept_admin();
    // the nominee had to sign
    let auths = t.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, multisig);
    assert_eq!(t.v.admin(), multisig);
    assert_eq!(t.v.pending_admin(), None);
    // without the nominee's signature acceptance fails
    let next = Address::generate(&t.env);
    t.v.propose_admin(&next);
    t.env.set_auths(&[]);
    assert!(t.v.try_accept_admin().is_err());
}

/// A registry that lies about the share and claims every user has a referrer.
#[contract]
pub struct EvilRegistry;

#[contractimpl]
impl EvilRegistry {
    pub fn __constructor(env: Env, referrer: Address) {
        env.storage().instance().set(&0u32, &referrer);
    }
    pub fn get_referrer(env: Env, _user: Address) -> Option<Address> {
        env.storage().instance().get(&0u32)
    }
    pub fn share_bps(_env: Env) -> u32 {
        1_000_000
    }
    pub fn record_reward(_env: Env, _s: Address, _r: Address, _t: Address, _a: i128) {}
}

#[test]
fn referral_cut_is_capped_even_with_a_lying_registry() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let admin = Address::generate(&env);
    let referrer = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let oracle_id = env.register(MockOracle, (&admin, 14u32, DELAY));
    let evil = env.register(EvilRegistry, (&referrer,));
    let vid = env.register(LeverageVault, (&admin, &usdc, &oracle_id, Some(evil), config(), DELAY));
    let v = LeverageVaultClient::new(&env, &vid);
    v.set_market(&xlm(&env), &true);
    MockOracleClient::new(&env, &oracle_id).set_price(&OAsset::Other(Symbol::new(&env, "XLM")), &P, &0);
    StellarAssetClient::new(&env, &usdc).mint(&admin, &10_000_000_000);
    v.fund_liquidity(&admin, &1_000_000_000);
    v.deposit(&admin, &2_000_000_000);
    v.open_position(&admin, &admin, &xlm(&env), &true, &1_000_000_000, &100_000);
    // fee = 10M; cut capped at 50% = 5M; reserve grew by the other 5M
    assert_eq!(v.free_collateral(&referrer), 5_000_000);
    assert_eq!(v.liquidity(), 1_000_000_000 + 5_000_000);
}


/// Regression F-08: the vault instance and position entries have their TTLs
/// extended on use (incl. `set_triggers`, which previously did not bump).
#[test]
fn regression_f08_vault_ttls_extended() {
    use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
    let t = setup();
    let u = trader(&t, 2_000_000_000);
    let id = t.v.open_position(&u, &u, &xlm(&t.env), &true, &1_000_000_000, &50_000);
    let seq = t.env.ledger().sequence();
    t.env.ledger().set_sequence_number(
        seq + quasaria_gov::PERSISTENT_BUMP_TO - quasaria_gov::PERSISTENT_BUMP_THRESHOLD + 10,
    );
    t.v.set_triggers(&u, &id, &0, &0);
    t.env.as_contract(&t.v.address, || {
        assert!(t.env.storage().instance().get_ttl() >= quasaria_gov::INSTANCE_BUMP_TO - 1);
        assert!(
            t.env.storage().persistent().get_ttl(&DataKey::Position(id))
                >= quasaria_gov::PERSISTENT_BUMP_TO - 1
        );
    });
}
