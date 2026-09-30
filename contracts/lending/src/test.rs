#![cfg(test)]
extern crate std;

use super::*;
use quasaria_gov::GovError;
use quasaria_mock_oracle::{Asset as OAsset, MockOracle, MockOracleClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    Event as _,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};

const P: i128 = 100_000_000_000_000; // $1.00 at 14 oracle decimals
const U: i128 = 10_000_000; // 1 token (7 decimals)
const DELAY: u64 = 300;
const T0: u64 = 1_000_000;

struct T {
    env: Env,
    pool: LendingPoolClient<'static>,
    oracle: MockOracleClient<'static>,
    usdc: Address,
    xlm: Address,
    shx: Address,
    admin: Address,
}

fn pool_config() -> PoolConfig {
    PoolConfig {
        max_price_age: 900,
        close_factor_bps: 5_000,
        close_dust_usd: 10 * P, // $10
        max_user_reserves: 8,
        max_borrowers: 1_000,
    }
}

fn stable_cfg() -> ReserveConfig {
    ReserveConfig {
        decimals: 7,
        ltv_bps: 8_000,
        liq_threshold_bps: 8_500,
        liq_bonus_bps: 500,
        reserve_factor_bps: 1_000,
        supply_cap: 10_000_000 * U,
        borrow_cap: 8_000_000 * U,
        min_supply: U,
        min_borrow: U,
        collateral_enabled: true,
        borrowable: true,
        base_rate_bps: 0,
        slope1_bps: 400,
        optimal_util_bps: 9_000,
        slope2_bps: 6_000,
    }
}

fn xlm_cfg() -> ReserveConfig {
    ReserveConfig {
        ltv_bps: 6_500,
        liq_threshold_bps: 7_500,
        liq_bonus_bps: 700,
        reserve_factor_bps: 2_000,
        base_rate_bps: 100,
        slope1_bps: 700,
        optimal_util_bps: 8_000,
        slope2_bps: 30_000,
        ..stable_cfg()
    }
}

fn smallcap_cfg() -> ReserveConfig {
    ReserveConfig {
        ltv_bps: 3_000,
        liq_threshold_bps: 4_000,
        liq_bonus_bps: 800,
        reserve_factor_bps: 2_500,
        supply_cap: 1_000_000 * U,
        borrow_cap: 200_000 * U,
        base_rate_bps: 200,
        slope1_bps: 1_000,
        optimal_util_bps: 6_000,
        slope2_bps: 30_000,
        ..stable_cfg()
    }
}

fn setup() -> T {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_timestamp(T0);
    let admin = Address::generate(&env);
    let oracle_id = env.register(MockOracle, (&admin, 14u32, DELAY));
    let oracle = MockOracleClient::new(&env, &oracle_id);
    let pid = env.register(LendingPool, (&admin, &oracle_id, pool_config(), DELAY));
    let pool = LendingPoolClient::new(&env, &pid);
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let xlm = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let shx = env.register_stellar_asset_contract_v2(admin.clone()).address();
    pool.add_reserve(&usdc, &stable_cfg());
    pool.add_reserve(&xlm, &xlm_cfg());
    pool.add_reserve(&shx, &smallcap_cfg());
    let t = T { env, pool, oracle, usdc, xlm, shx, admin };
    t.px(&t.usdc.clone(), P);
    t.px(&t.xlm.clone(), P / 4); // $0.25
    t.px(&t.shx.clone(), P / 200); // $0.005
    t
}

impl T {
    fn px(&self, a: &Address, price: i128) {
        self.oracle.set_price(&OAsset::Stellar(a.clone()), &price, &0);
    }
    fn user(&self) -> Address {
        let u = Address::generate(&self.env);
        for a in [&self.usdc, &self.xlm, &self.shx] {
            StellarAssetClient::new(&self.env, a).mint(&u, &(1_000_000_000 * U));
        }
        u
    }
    fn bal(&self, a: &Address, who: &Address) -> i128 {
        TokenClient::new(&self.env, a).balance(who)
    }
    fn warp(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(now + secs);
    }
    /// Refresh all oracle prices at the current time (same values).
    fn refresh(&self) {
        for a in [&self.usdc, &self.xlm, &self.shx] {
            let pd = self.oracle.lastprice(&OAsset::Stellar(a.clone())).unwrap();
            self.px(a, pd.price);
        }
    }
    /// A liquidity provider supplying `n` tokens of each asset.
    fn lp(&self, n: i128) -> Address {
        let lp = self.user();
        for a in [&self.usdc, &self.xlm, &self.shx] {
            self.pool.supply(&lp, a, &(n * U));
        }
        lp
    }
    /// Core accounting invariant: assets cover liabilities.
    fn solvent(&self, a: &Address) {
        let r = self.pool.reserve(a);
        assert!(
            r.state.cash + r.total_debt + r.state.bad_debt >= r.total_supply + r.state.treasury,
            "reserve insolvent: {:?}",
            r
        );
        assert!(self.bal(a, &self.pool.address) >= r.state.cash);
    }
}

fn err<T, E: core::fmt::Debug>(r: Result<T, Result<soroban_sdk::Error, E>>) -> soroban_sdk::Error {
    match r {
        Err(Ok(e)) => e,
        Err(Err(e)) => panic!("invoke error {:?}", e),
        Ok(_) => panic!("expected error"),
    }
}

fn le(e: LendError) -> soroban_sdk::Error {
    e.into()
}

// ------------------------------------------------------------------ basics

#[test]
fn supply_and_withdraw_roundtrip() {
    let t = setup();
    let u = t.user();
    let before = t.bal(&t.usdc, &u);
    t.pool.supply(&u, &t.usdc, &(100 * U));
    let v = t.pool.user_reserve(&u, &t.usdc);
    assert_eq!(v.supplied, 100 * U);
    assert!(v.collateral, "first supply of a collateral asset auto-enables");
    assert_eq!(t.pool.user_assets(&u).len(), 1);
    assert_eq!(t.pool.withdraw(&u, &t.usdc, &(40 * U)), 40 * U);
    assert_eq!(t.pool.withdraw(&u, &t.usdc, &i128::MAX), 60 * U);
    let evs = t.env.events().all().filter_by_contract(&t.pool.address);
    assert_eq!(
        evs.events(),
        std::vec![Withdrawn { user: u.clone(), asset: t.usdc.clone(), amount: 60 * U }
            .to_xdr(&t.env, &t.pool.address)]
        .as_slice()
    );
    assert_eq!(t.bal(&t.usdc, &u), before);
    assert_eq!(t.pool.user_assets(&u).len(), 0, "empty positions are deleted");
}

#[test]
fn zero_amounts_rejected() {
    let t = setup();
    let u = t.user();
    assert_eq!(err(t.pool.try_supply(&u, &t.usdc, &0)), le(LendError::ZeroAmount));
    assert_eq!(err(t.pool.try_borrow(&u, &t.usdc, &-1)), le(LendError::ZeroAmount));
    assert_eq!(err(t.pool.try_withdraw(&u, &t.usdc, &0)), le(LendError::ZeroAmount));
    assert_eq!(err(t.pool.try_repay(&u, &u, &t.usdc, &0)), le(LendError::ZeroAmount));
    assert_eq!(err(t.pool.try_withdraw(&u, &t.usdc, &U)), le(LendError::InsufficientBalance));
    assert_eq!(err(t.pool.try_repay(&u, &u, &t.usdc, &U)), le(LendError::NoDebt));
}

#[test]
fn unknown_reserve_and_duplicate_listing() {
    let t = setup();
    let u = t.user();
    let other = Address::generate(&t.env);
    assert_eq!(err(t.pool.try_supply(&u, &other, &U)), le(LendError::ReserveNotFound));
    assert_eq!(err(t.pool.try_add_reserve(&t.usdc, &stable_cfg())), le(LendError::ReserveExists));
    assert_eq!(t.pool.reserve_list().len(), 3);
    assert_eq!(t.pool.reserves_page(&1, &500).len(), 2);
    assert_eq!(t.pool.oracle_decimals(), 14);
}

// ------------------------------------------------------------------ rates & interest

#[test]
fn rate_model_kink() {
    let env = Env::default();
    let c = stable_cfg(); // base 0, slope1 4%, kink 90%, slope2 60%
    assert_eq!(borrow_rate_bps(&env, &c, 0), 0);
    assert_eq!(borrow_rate_bps(&env, &c, 4_500), 200);
    assert_eq!(borrow_rate_bps(&env, &c, 9_000), 400);
    assert_eq!(borrow_rate_bps(&env, &c, 9_500), 400 + 3_000);
    assert_eq!(borrow_rate_bps(&env, &c, 10_000), 6_400);
    // slope is much steeper above the kink
    let below = borrow_rate_bps(&env, &c, 9_000) - borrow_rate_bps(&env, &c, 8_900);
    let above = borrow_rate_bps(&env, &c, 9_100) - borrow_rate_bps(&env, &c, 9_000);
    assert!(above > 10 * below);
    // supply rate = borrow × U × (1 − rf)
    assert_eq!(supply_rate_bps(&env, &c, 9_000), 400 * 9 / 10 * 9 / 10);
    assert_eq!(utilization_bps(&env, 100, 0), 0);
    assert_eq!(utilization_bps(&env, 0, 100), BPS);
    assert_eq!(utilization_bps(&env, 50, 50), 5_000);
}

#[test]
fn interest_accrues_to_suppliers_and_treasury() {
    let t = setup();
    let lp = t.user();
    t.pool.supply(&lp, &t.usdc, &(10_000 * U));
    let b = t.user();
    t.pool.supply(&b, &t.xlm, &(80_000 * U)); // $20k collateral
    t.pool.borrow(&b, &t.usdc, &(9_000 * U)); // U = 90% → 4% APR
    let r0 = t.pool.reserve(&t.usdc);
    assert_eq!(r0.utilization_bps, 9_000);
    assert_eq!(r0.borrow_rate_bps, 400);
    t.warp(31_536_000);
    t.refresh();
    let debt = t.pool.user_reserve(&b, &t.usdc).borrowed;
    // simple interest over one accrual: 9000 × 4% = 360
    assert!((debt - 9_360 * U).abs() <= 2, "debt {}", debt);
    let sup = t.pool.user_reserve(&lp, &t.usdc).supplied;
    // suppliers get 90 % of the interest (reserve factor 10 %)
    assert!((sup - (10_000 * U + 324 * U)).abs() <= 2, "supply {}", sup);
    let r = t.pool.reserve(&t.usdc);
    assert!((r.state.treasury - 36 * U).abs() <= 2);
    t.solvent(&t.usdc);
    // accrual persisted via accrue_interest is identical to the view
    t.pool.accrue_interest(&t.usdc);
    assert_eq!(t.pool.reserve(&t.usdc).state, r.state);
    // compounding across accruals: two half-year steps ≥ one full-year step
    t.warp(1);
    t.pool.accrue_interest(&t.usdc);
    assert!(t.pool.user_reserve(&b, &t.usdc).borrowed >= debt);
}

#[test]
fn repay_all_after_interest_and_withdraw_all() {
    let t = setup();
    let lp = t.user();
    t.pool.supply(&lp, &t.xlm, &(100_000 * U));
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(1_000 * U));
    t.pool.borrow(&b, &t.xlm, &(1_000 * U));
    assert_eq!(t.pool.borrower_count(), 1);
    t.warp(30 * 86_400);
    t.refresh();
    let owed = t.pool.user_reserve(&b, &t.xlm).borrowed;
    assert!(owed > 1_000 * U);
    let paid = t.pool.repay(&b, &b, &t.xlm, &i128::MAX);
    assert_eq!(paid, owed);
    assert_eq!(t.pool.user_reserve(&b, &t.xlm).borrowed, 0);
    assert_eq!(t.pool.borrower_count(), 0);
    assert_eq!(t.pool.withdraw(&b, &t.usdc, &i128::MAX), 1_000 * U);
    let got = t.pool.withdraw(&lp, &t.xlm, &i128::MAX);
    assert!(got > 100_000 * U, "supplier earned interest");
    t.solvent(&t.xlm);
}

// ------------------------------------------------------------------ HF & limits

#[test]
fn health_factor_math() {
    let t = setup();
    t.lp(500_000);
    let u = t.user();
    t.pool.supply(&u, &t.usdc, &(1_000 * U)); // $1000 ×0.80 / ×0.85
    t.pool.supply(&u, &t.xlm, &(4_000 * U)); // $1000 ×0.65 / ×0.75
    let a = t.pool.account(&u);
    assert_eq!(a.collateral_usd, 2_000 * P);
    assert_eq!(a.borrow_limit_usd, 1_450 * P);
    assert_eq!(a.liq_threshold_usd, 1_600 * P);
    assert_eq!(a.health_factor, i128::MAX);
    t.pool.borrow(&u, &t.shx, &(160_000 * U)); // $800
    let a = t.pool.account(&u);
    assert_eq!(a.debt_usd, 800 * P);
    assert_eq!(a.health_factor, 2 * HF_ONE);
    assert_eq!(health_factor(&t.env, 1, 0), i128::MAX);
    assert_eq!(health_factor(&t.env, 3, 4), 7_500_000);
}

#[test]
fn borrow_limit_enforced() {
    let t = setup();
    t.lp(100_000);
    let u = t.user();
    t.pool.supply(&u, &t.usdc, &(1_000 * U)); // limit $800
    assert_eq!(
        err(t.pool.try_borrow(&u, &t.xlm, &(3_201 * U))),
        le(LendError::InsufficientCollateral)
    );
    t.pool.borrow(&u, &t.xlm, &(3_200 * U)); // exactly $800
    assert_eq!(err(t.pool.try_borrow(&u, &t.xlm, &U)), le(LendError::InsufficientCollateral));
    // without collateral you can't borrow at all
    let v = t.user();
    t.pool.supply(&v, &t.usdc, &(1_000 * U));
    t.pool.set_collateral(&v, &t.usdc, &false);
    assert_eq!(err(t.pool.try_borrow(&v, &t.xlm, &U)), le(LendError::InsufficientCollateral));
}

#[test]
fn withdraw_and_collateral_toggle_blocked_when_unsafe() {
    let t = setup();
    t.lp(100_000);
    let u = t.user();
    t.pool.supply(&u, &t.usdc, &(1_000 * U));
    t.pool.supply(&u, &t.shx, &(10_000 * U)); // tiny extra collateral
    t.pool.borrow(&u, &t.xlm, &(3_000 * U)); // $750, threshold $850 + $20
    // withdrawing 200 USDC would give HF = (680+20)/750 < 1
    assert_eq!(
        err(t.pool.try_withdraw(&u, &t.usdc, &(200 * U))),
        le(LendError::HealthFactorTooLow)
    );
    assert_eq!(
        err(t.pool.try_set_collateral(&u, &t.usdc, &false)),
        le(LendError::HealthFactorTooLow)
    );
    // a small withdrawal that keeps HF ≥ 1 is fine
    t.pool.withdraw(&u, &t.usdc, &(100 * U));
    assert!(t.pool.account(&u).health_factor >= HF_ONE);
    // non-critical collateral can be disabled / withdrawn
    t.pool.set_collateral(&u, &t.shx, &false);
    t.pool.withdraw(&u, &t.shx, &i128::MAX);
}

#[test]
fn reserve_flags_respected() {
    let t = setup();
    let lp = t.lp(100_000);
    let flagged = Address::generate(&t.env);
    let borrow_only = ReserveConfig {
        ltv_bps: 0,
        liq_threshold_bps: 0,
        liq_bonus_bps: 0,
        collateral_enabled: false,
        ..stable_cfg()
    };
    t.pool.add_reserve(&flagged, &borrow_only);
    let tok = t.env.register_stellar_asset_contract_v2(t.admin.clone()).address();
    let _ = tok;
    let u = t.user();
    StellarAssetClient::new(&t.env, &t.usdc).mint(&u, &U);
    // non-collateral asset can't be enabled
    let no_borrow = Address::generate(&t.env);
    let c = ReserveConfig { borrowable: false, borrow_cap: 0, ..stable_cfg() };
    t.pool.add_reserve(&no_borrow, &c);
    assert_eq!(err(t.pool.try_borrow(&u, &no_borrow, &U)), le(LendError::NotBorrowable));
    assert_eq!(err(t.pool.try_set_collateral(&u, &flagged, &true)), le(LendError::NotCollateral));
    assert_eq!(
        err(t.pool.try_set_collateral(&u, &t.usdc, &true)),
        le(LendError::InsufficientBalance)
    );
    let _ = lp;
}

#[test]
fn supply_and_borrow_caps() {
    let t = setup();
    let u = t.user();
    let big = 1_000_000 * U;
    t.pool.supply(&u, &t.shx, &big); // exactly the cap
    assert_eq!(err(t.pool.try_supply(&u, &t.shx, &U)), le(LendError::SupplyCapExceeded));
    t.pool.supply(&u, &t.usdc, &(1_000_000 * U));
    assert_eq!(
        err(t.pool.try_borrow(&u, &t.shx, &(200_001 * U))),
        le(LendError::BorrowCapExceeded)
    );
    t.pool.borrow(&u, &t.shx, &(200_000 * U));
    // liquidity check
    let v = t.user();
    t.pool.supply(&v, &t.usdc, &(10_000_000 * U - 1_000_000 * U));
    t.pool.withdraw(&u, &t.shx, &(700_000 * U));
    assert_eq!(err(t.pool.try_withdraw(&u, &t.shx, &i128::MAX)), le(LendError::InsufficientLiquidity));
}

#[test]
fn per_user_reserve_cap_and_borrower_paging() {
    let t = setup();
    // 8 reserves max per user: list 6 more
    let mut extra = std::vec::Vec::new();
    for _ in 0..6 {
        let a = t.env.register_stellar_asset_contract_v2(t.admin.clone()).address();
        t.pool.add_reserve(&a, &stable_cfg());
        t.px(&a, P);
        extra.push(a);
    }
    let u = t.user();
    for a in [&t.usdc, &t.xlm, &t.shx] {
        t.pool.supply(&u, a, &U);
    }
    for a in extra.iter().take(5) {
        StellarAssetClient::new(&t.env, a).mint(&u, &(10 * U));
        t.pool.supply(&u, a, &U);
    }
    let ninth = &extra[5];
    StellarAssetClient::new(&t.env, ninth).mint(&u, &(10 * U));
    assert_eq!(err(t.pool.try_supply(&u, ninth, &U)), le(LendError::TooManyUserReserves));
    // borrower index is paged and swap-removed
    t.lp(100_000);
    let mut bs = std::vec::Vec::new();
    for _ in 0..5 {
        let b = t.user();
        t.pool.supply(&b, &t.usdc, &(100 * U));
        t.pool.borrow(&b, &t.xlm, &(10 * U));
        bs.push(b);
    }
    assert_eq!(t.pool.borrower_count(), 5);
    assert_eq!(t.pool.borrowers_page(&0, &2).len(), 2);
    assert_eq!(t.pool.borrowers_page(&4, &100).len(), 1);
    assert_eq!(t.pool.borrowers_page(&0, &1_000).len(), 5);
    t.pool.repay(&bs[1], &bs[1], &t.xlm, &i128::MAX);
    assert_eq!(t.pool.borrower_count(), 4);
    let page = t.pool.borrowers_page(&0, &10);
    assert!(!page.contains(&bs[1]));
    assert!(page.contains(&bs[4]));
}

#[test]
fn max_borrowers_cap() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_timestamp(T0);
    let admin = Address::generate(&env);
    let oid = env.register(MockOracle, (&admin, 14u32, DELAY));
    let cfg = PoolConfig { max_borrowers: 1, ..pool_config() };
    let pool = LendingPoolClient::new(&env, &env.register(LendingPool, (&admin, &oid, cfg, DELAY)));
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
    pool.add_reserve(&usdc, &stable_cfg());
    MockOracleClient::new(&env, &oid).set_price(&OAsset::Stellar(usdc.clone()), &P, &0);
    let mut us = std::vec::Vec::new();
    for _ in 0..2 {
        let u = Address::generate(&env);
        StellarAssetClient::new(&env, &usdc).mint(&u, &(1_000 * U));
        pool.supply(&u, &usdc, &(1_000 * U));
        us.push(u);
    }
    pool.borrow(&us[0], &usdc, &(10 * U));
    pool.borrow(&us[0], &usdc, &(10 * U)); // same borrower: fine
    assert_eq!(err(pool.try_borrow(&us[1], &usdc, &(10 * U))), le(LendError::TooManyBorrowers));
}

// ------------------------------------------------------------------ repay

#[test]
fn third_party_repay() {
    let t = setup();
    t.lp(100_000);
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(1_000 * U));
    t.pool.borrow(&b, &t.xlm, &(1_000 * U));
    let friend = t.user();
    let fb = t.bal(&t.xlm, &friend);
    t.pool.repay(&friend, &b, &t.xlm, &(400 * U));
    assert_eq!(t.bal(&t.xlm, &friend), fb - 400 * U);
    assert_eq!(t.pool.user_reserve(&b, &t.xlm).borrowed, 600 * U);
    let paid = t.pool.repay(&friend, &b, &t.xlm, &(10_000 * U));
    assert_eq!(paid, 600 * U, "over-repay is capped at the debt");
    assert_eq!(t.pool.borrower_count(), 0);
}

// ------------------------------------------------------------------ dust (F-02)

#[test]
fn dust_limits() {
    let t = setup();
    t.lp(100_000);
    let u = t.user();
    assert_eq!(err(t.pool.try_supply(&u, &t.usdc, &(U - 1))), le(LendError::BelowMinSupply));
    assert_eq!(err(t.pool.try_supply(&u, &t.usdc, &1)), le(LendError::BelowMinSupply));
    t.pool.supply(&u, &t.usdc, &(10 * U));
    assert_eq!(
        err(t.pool.try_withdraw(&u, &t.usdc, &(10 * U - U / 2))),
        le(LendError::DustRemaining)
    );
    assert_eq!(err(t.pool.try_borrow(&u, &t.xlm, &(U - 1))), le(LendError::BelowMinBorrow));
    t.pool.borrow(&u, &t.xlm, &(2 * U));
    assert_eq!(err(t.pool.try_repay(&u, &u, &t.xlm, &(U + 1))), le(LendError::DustRemaining));
    t.pool.repay(&u, &u, &t.xlm, &U);
    t.pool.repay(&u, &u, &t.xlm, &i128::MAX);
}

// ------------------------------------------------------------------ oracle (F-07)

#[test]
fn oracle_staleness_future_and_missing() {
    let t = setup();
    t.lp(100_000);
    let u = t.user();
    t.pool.supply(&u, &t.usdc, &(1_000 * U));
    t.warp(901);
    assert_eq!(err(t.pool.try_borrow(&u, &t.xlm, &(10 * U))), le(LendError::StalePrice));
    t.refresh();
    t.pool.borrow(&u, &t.xlm, &(10 * U));
    // future-dated beyond the 60 s skew
    let now = t.env.ledger().timestamp();
    t.oracle.set_price(&OAsset::Stellar(t.xlm.clone()), &(P / 4), &(now + 61));
    assert_eq!(err(t.pool.try_borrow(&u, &t.xlm, &(10 * U))), le(LendError::FuturePrice));
    t.oracle.set_price(&OAsset::Stellar(t.xlm.clone()), &(P / 4), &(now + 60));
    t.pool.borrow(&u, &t.xlm, &(10 * U));
    // zero / negative price
    t.px(&t.xlm, 0);
    assert_eq!(err(t.pool.try_borrow(&u, &t.xlm, &(10 * U))), le(LendError::NoPrice));
    // unpriced reserve
    let a = t.env.register_stellar_asset_contract_v2(t.admin.clone()).address();
    t.pool.add_reserve(&a, &stable_cfg());
    StellarAssetClient::new(&t.env, &a).mint(&u, &(10 * U));
    t.pool.supply(&u, &a, &(10 * U));
    assert_eq!(err(t.pool.try_account(&u)), le(LendError::NoPrice));
    // a user without debt can still withdraw with a broken oracle
    let v = t.user();
    t.pool.supply(&v, &t.xlm, &(10 * U));
    t.pool.withdraw(&v, &t.xlm, &i128::MAX);
    // repay never needs a price
    t.pool.repay(&u, &u, &t.xlm, &i128::MAX);
}

#[test]
fn check_price_unit() {
    let env = Env::default();
    env.ledger().set_timestamp(10_000);
    assert_eq!(check_price(&env, &PriceData { price: 5, timestamp: 10_000 }, 100), 5);
    assert_eq!(check_price(&env, &PriceData { price: 5, timestamp: 9_900 }, 100), 5);
    assert_eq!(check_price(&env, &PriceData { price: 5, timestamp: 10_060 }, 100), 5);
}

// ------------------------------------------------------------------ liquidation

/// Borrower with 1000 USDC collateral, borrows 3000 XLM ($750); then XLM → $0.30.
fn unhealthy(t: &T) -> Address {
    t.lp(100_000);
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(1_000 * U));
    t.pool.borrow(&b, &t.xlm, &(3_000 * U));
    let liq = t.user();
    assert_eq!(
        err(t.pool.try_liquidate(&liq, &b, &t.xlm, &t.usdc, &(100 * U), &false)),
        le(LendError::Healthy)
    );
    t.px(&t.xlm, 30 * P / 100); // debt $900 > threshold $850
    assert!(t.pool.account(&b).health_factor < HF_ONE);
    b
}

#[test]
fn liquidation_close_factor_and_bonus() {
    let t = setup();
    let b = unhealthy(&t);
    let liq = t.user();
    let usdc0 = t.bal(&t.usdc, &liq);
    let xlm0 = t.bal(&t.xlm, &liq);
    // asks for everything; capped at 50 % of 3000 XLM
    let (repaid, seized) = t.pool.liquidate(&liq, &b, &t.xlm, &t.usdc, &(3_000 * U), &false);
    assert_eq!(repaid, 1_500 * U);
    // 1500 XLM × $0.30 = $450, +5 % USDC bonus = $472.5
    assert_eq!(seized, 4_725 * U / 10);
    assert_eq!(t.bal(&t.usdc, &liq) - usdc0, seized);
    assert_eq!(xlm0 - t.bal(&t.xlm, &liq), repaid);
    assert_eq!(t.pool.user_reserve(&b, &t.xlm).borrowed, 1_500 * U);
    assert_eq!(t.pool.user_reserve(&b, &t.usdc).supplied, 1_000 * U - seized);
    // HF improved: (527.5 × 0.85) / 450 ≈ 0.996 → still liquidatable, second chunk
    let hf = t.pool.account(&b).health_factor;
    assert!(hf > 9_000_000);
    if hf < HF_ONE {
        let (r2, _) = t.pool.liquidate(&liq, &b, &t.xlm, &t.usdc, &(3_000 * U), &false);
        assert_eq!(r2, 750 * U, "each call is capped at 50 % of the remaining debt");
    }
    assert!(t.pool.account(&b).health_factor >= HF_ONE);
    assert_eq!(
        err(t.pool.try_liquidate(&liq, &b, &t.xlm, &t.usdc, &U, &false)),
        le(LendError::Healthy)
    );
    t.solvent(&t.usdc);
    t.solvent(&t.xlm);
}

#[test]
fn liquidation_bonus_per_asset() {
    let t = setup();
    t.lp(500_000);
    let b = t.user();
    t.pool.supply(&b, &t.shx, &(100_000 * U)); // $500, LTV 30 %, thr 40 %, bonus 8 %
    t.pool.borrow(&b, &t.usdc, &(150 * U));
    t.px(&t.shx, P / 400); // $0.0025 → collateral $250, thr $100 < $150
    let liq = t.user();
    let (repaid, seized) = t.pool.liquidate(&liq, &b, &t.usdc, &t.shx, &(50 * U), &true);
    assert_eq!(repaid, 50 * U);
    // $50 × 1.08 / $0.0025 = 21_600 SHX, received as supply shares
    assert_eq!(seized, 21_600 * U);
    let lv = t.pool.user_reserve(&liq, &t.shx);
    assert!(lv.supplied >= seized - 1 && lv.supplied <= seized);
    assert!(!lv.collateral, "seized shares are not auto-collateral");
    t.solvent(&t.shx);
}

#[test]
fn full_close_only_below_dust_threshold() {
    let t = setup();
    t.lp(100_000);
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(10 * U));
    t.pool.borrow(&b, &t.xlm, &(30 * U)); // $7.50 ≤ $10 dust threshold
    t.px(&t.xlm, 30 * P / 100); // $9 > $8.5
    let liq = t.user();
    let (repaid, _) = t.pool.liquidate(&liq, &b, &t.xlm, &t.usdc, &i128::MAX, &false);
    assert_eq!(repaid, 30 * U, "dust debt is closed in full");
    assert_eq!(t.pool.user_reserve(&b, &t.xlm).borrowed, 0);
    assert_eq!(t.pool.borrower_count(), 0);
    // a large position is never closed in full in one call
    let t2 = setup();
    let b2 = unhealthy(&t2);
    let l2 = t2.user();
    let (r, _) = t2.pool.liquidate(&l2, &b2, &t2.xlm, &t2.usdc, &i128::MAX, &false);
    assert_eq!(r, 1_500 * U);
}

#[test]
fn liquidation_rejects_bad_inputs() {
    let t = setup();
    let b = unhealthy(&t);
    let liq = t.user();
    assert_eq!(
        err(t.pool.try_liquidate(&liq, &b, &t.usdc, &t.usdc, &U, &false)),
        le(LendError::NoDebt)
    );
    assert_eq!(
        err(t.pool.try_liquidate(&liq, &b, &t.xlm, &t.shx, &U, &false)),
        le(LendError::NothingToSeize)
    );
    assert_eq!(
        err(t.pool.try_liquidate(&liq, &b, &t.xlm, &t.usdc, &0, &false)),
        le(LendError::ZeroAmount)
    );
}

#[test]
fn bad_debt_recorded_and_covered() {
    let t = setup();
    t.lp(100_000);
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(100 * U));
    t.pool.borrow(&b, &t.xlm, &(300 * U)); // $75
    // accrue a little treasury first
    t.warp(86_400 * 10);
    t.refresh();
    t.pool.accrue_interest(&t.xlm);
    let treasury = t.pool.reserve(&t.xlm).state.treasury;
    assert!(treasury > 0);
    t.px(&t.xlm, 2 * P); // debt ≈ $600 ≫ $100 collateral
    let liq = t.user();
    let (repaid, seized) = t.pool.liquidate(&liq, &b, &t.xlm, &t.usdc, &i128::MAX, &false);
    assert_eq!(seized, 100 * U, "all collateral seized");
    // $100 / 1.05 / $2 ≈ 47.62 XLM
    assert!(repaid > 47 * U && repaid < 48 * U, "{}", repaid);
    let r = t.pool.reserve(&t.xlm);
    assert_eq!(t.pool.user_reserve(&b, &t.xlm).borrowed, 0, "remaining debt written off");
    assert_eq!(r.state.treasury, 0, "treasury absorbed first");
    assert!(r.state.bad_debt > 250 * U);
    assert_eq!(t.pool.borrower_count(), 0);
    assert_eq!(t.pool.user_assets(&b).len(), 0);
    t.solvent(&t.xlm);
    // anyone can cover it
    let donor = t.user();
    let bd = r.state.bad_debt;
    assert_eq!(t.pool.cover_bad_debt(&donor, &t.xlm, &(10_000 * U)), bd);
    assert_eq!(t.pool.reserve(&t.xlm).state.bad_debt, 0);
    assert_eq!(err(t.pool.try_cover_bad_debt(&donor, &t.xlm, &U)), le(LendError::NotBadDebt));
    assert_eq!(err(t.pool.try_resolve_bad_debt(&b)), le(LendError::NotBadDebt));
}

// ------------------------------------------------------------------ pause

#[test]
fn pause_blocks_new_risk_but_not_exits() {
    let t = setup();
    let b = unhealthy(&t);
    let u = t.user();
    t.pool.supply(&u, &t.usdc, &(1_000 * U));
    t.pool.borrow(&u, &t.xlm, &(100 * U));
    let guardian = Address::generate(&t.env);
    t.pool.set_guardian(&guardian);
    t.pool.pause(&guardian);
    assert!(t.pool.paused());
    let g: soroban_sdk::Error = GovError::Paused.into();
    assert_eq!(err(t.pool.try_supply(&u, &t.usdc, &U)), g);
    assert_eq!(err(t.pool.try_borrow(&u, &t.xlm, &U)), g);
    // repay, safe withdraw, liquidation keep working
    t.pool.repay(&u, &u, &t.xlm, &(50 * U));
    t.pool.withdraw(&u, &t.usdc, &(100 * U));
    let liq = t.user();
    t.pool.liquidate(&liq, &b, &t.xlm, &t.usdc, &(100 * U), &false);
    // unsafe withdraw still blocked
    assert_eq!(
        err(t.pool.try_withdraw(&b, &t.usdc, &(500 * U))),
        le(LendError::HealthFactorTooLow)
    );
    // guardian can't unpause; admin can
    t.pool.unpause();
    assert!(!t.pool.paused());
    let stranger = Address::generate(&t.env);
    assert!(t.pool.try_pause(&stranger).is_err());
}

// ------------------------------------------------------------------ governance

#[test]
fn timelock_for_dangerous_changes() {
    let t = setup();
    // raising LTV can't be applied immediately
    let mut up = stable_cfg();
    up.ltv_bps = 8_400;
    assert_eq!(err(t.pool.try_tighten_reserve(&t.usdc, &up)), le(LendError::NotRiskReducing));
    let a = LendingAction::SetReserveConfig(t.usdc.clone(), up.clone());
    let eta = t.pool.propose_action(&a);
    assert_eq!(eta, T0 + DELAY);
    let g: soroban_sdk::Error = GovError::TimelockNotReady.into();
    assert_eq!(err(t.pool.try_execute_action(&a)), g);
    t.warp(DELAY);
    t.pool.execute_action(&a);
    assert_eq!(t.pool.reserve_config(&t.usdc).ltv_bps, 8_400);
    // lowering LTV / caps / disabling borrow is immediate
    let mut down = up.clone();
    down.ltv_bps = 7_000;
    down.borrowable = false;
    down.borrow_cap = 0;
    down.supply_cap = 1_000 * U;
    t.pool.tighten_reserve(&t.usdc, &down);
    assert!(!t.pool.reserve_config(&t.usdc).borrowable);
    // re-enabling borrow is not risk-reducing
    assert_eq!(err(t.pool.try_tighten_reserve(&t.usdc, &up)), le(LendError::NotRiskReducing));
    // changing the rate model or threshold needs the timelock
    let mut rate = down.clone();
    rate.slope2_bps = 7_000;
    assert_eq!(err(t.pool.try_tighten_reserve(&t.usdc, &rate)), le(LendError::NotRiskReducing));
    // oracle swap via timelock
    let o2 = t.env.register(MockOracle, (&t.admin, 8u32, DELAY));
    let so = LendingAction::SetOracle(o2.clone());
    t.pool.propose_action(&so);
    t.warp(DELAY);
    t.pool.execute_action(&so);
    assert_eq!(t.pool.oracle(), o2);
    assert_eq!(t.pool.oracle_decimals(), 8);
    // pool config via timelock (validated at execution)
    let bad = LendingAction::SetPoolConfig(PoolConfig { close_factor_bps: 9_000, ..pool_config() });
    t.pool.propose_action(&bad);
    t.warp(DELAY);
    assert_eq!(err(t.pool.try_execute_action(&bad)), le(LendError::InvalidConfig));
    let good = LendingAction::SetPoolConfig(PoolConfig { max_price_age: 600, ..pool_config() });
    t.pool.propose_action(&good);
    t.warp(DELAY);
    t.pool.execute_action(&good);
    assert_eq!(t.pool.pool_config().max_price_age, 600);
    // cancel
    let d = LendingAction::SetDelay(600);
    t.pool.propose_action(&d);
    t.pool.cancel_action(&t.admin, &d);
    assert_eq!(t.pool.action_eta(&d), None);
    // upgrade / set delay are timelocked actions too
    let sd = LendingAction::SetDelay(900);
    t.pool.propose_action(&sd);
    t.warp(DELAY);
    t.pool.execute_action(&sd);
    assert_eq!(t.pool.timelock_delay(), 900);
    let up = LendingAction::Upgrade(BytesN::from_array(&t.env, &[0u8; 32]));
    t.pool.propose_action(&up);
    assert_eq!(err(t.pool.try_execute_action(&up)), g);
}

#[test]
fn treasury_withdrawal_timelocked() {
    let t = setup();
    t.lp(100_000);
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(10_000 * U));
    t.pool.borrow(&b, &t.xlm, &(20_000 * U));
    t.warp(31_536_000);
    t.refresh();
    t.pool.accrue_interest(&t.xlm);
    let tr = t.pool.reserve(&t.xlm).state.treasury;
    assert!(tr > 0);
    let to = Address::generate(&t.env);
    let too_much = LendingAction::WithdrawTreasury(t.xlm.clone(), to.clone(), tr * 1_000);
    t.pool.propose_action(&too_much);
    t.warp(DELAY);
    assert_eq!(err(t.pool.try_execute_action(&too_much)), le(LendError::InsufficientLiquidity));
    let a = LendingAction::WithdrawTreasury(t.xlm.clone(), to.clone(), tr);
    t.pool.propose_action(&a);
    t.warp(DELAY);
    t.refresh();
    t.pool.execute_action(&a);
    assert_eq!(t.bal(&t.xlm, &to), tr);
    t.solvent(&t.xlm);
}

#[test]
fn admin_only_and_two_step_admin() {
    let t = setup();
    let next = Address::generate(&t.env);
    t.pool.propose_admin(&next);
    assert_eq!(t.pool.admin(), t.admin);
    t.pool.accept_admin();
    assert_eq!(t.pool.admin(), next);
    t.env.set_auths(&[]);
    let a = Address::generate(&t.env);
    assert!(t.pool.try_add_reserve(&a, &stable_cfg()).is_err());
    assert!(t.pool.try_tighten_reserve(&t.usdc, &stable_cfg()).is_err());
    assert!(t.pool.try_propose_action(&LendingAction::SetDelay(600)).is_err());
    assert!(t.pool.try_unpause().is_err());
    let u = Address::generate(&t.env);
    assert!(t.pool.try_supply(&u, &t.usdc, &U).is_err(), "user auth required");
}

#[test]
fn config_bounds() {
    let env = Env::default();
    let ok = stable_cfg();
    validate_reserve_config(&env, &ok);
    let bads = [
        ReserveConfig { ltv_bps: 8_600, ..ok.clone() },                 // ltv > threshold
        ReserveConfig { liq_threshold_bps: 9_500, ..ok.clone() },       // ≥ 95 %
        ReserveConfig { liq_bonus_bps: 1_001, ..ok.clone() },           // > 10 %
        ReserveConfig { liq_threshold_bps: 9_400, liq_bonus_bps: 700, ..ok.clone() }, // thr×(1+b) ≥ 1
        ReserveConfig { reserve_factor_bps: 5_001, ..ok.clone() },
        ReserveConfig { supply_cap: 0, ..ok.clone() },
        ReserveConfig { borrow_cap: ok.supply_cap + 1, ..ok.clone() },
        ReserveConfig { min_borrow: 999, ..ok.clone() },
        ReserveConfig { min_supply: 1, ..ok.clone() },
        ReserveConfig { optimal_util_bps: 9_600, ..ok.clone() },
        ReserveConfig { optimal_util_bps: 500, ..ok.clone() },
        ReserveConfig { slope2_bps: 50_001, ..ok.clone() },
        ReserveConfig { base_rate_bps: 2_001, ..ok.clone() },
        ReserveConfig { decimals: 19, ..ok.clone() },
        ReserveConfig { collateral_enabled: false, ..ok.clone() },       // ltv must be 0
        ReserveConfig { liq_bonus_bps: 0, ..ok.clone() },                // collateral needs bonus
        ReserveConfig { borrow_cap: 0, ..ok.clone() },                   // borrowable needs cap
    ];
    for (i, b) in bads.iter().enumerate() {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            validate_reserve_config(&env, b);
        }));
        assert!(r.is_err(), "bad config #{} accepted", i);
    }
    for b in [
        PoolConfig { max_price_age: 0, ..pool_config() },
        PoolConfig { max_price_age: 3_601, ..pool_config() },
        PoolConfig { close_factor_bps: 5_001, ..pool_config() },
        PoolConfig { close_factor_bps: 999, ..pool_config() },
        PoolConfig { max_user_reserves: 11, ..pool_config() },
        PoolConfig { max_borrowers: 0, ..pool_config() },
        PoolConfig { close_dust_usd: -1, ..pool_config() },
    ] {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            validate_pool_config(&env, &b);
        }));
        assert!(r.is_err());
    }
    let t = setup();
    let a = Address::generate(&t.env);
    assert_eq!(
        err(t.pool.try_add_reserve(&a, &ReserveConfig { ltv_bps: 9_000, ..stable_cfg() })),
        le(LendError::InvalidConfig)
    );
}

#[test]
fn mainnet_rules() {
    let env = Env::default();
    env.mock_all_auths();
    let h = env
        .crypto()
        .sha256(&soroban_sdk::Bytes::from_slice(&env, gov::MAINNET_PASSPHRASE))
        .to_array();
    env.ledger().set_network_id(h);
    let admin = Address::generate(&env);
    let oid = env.register(MockOracle, (&admin, 14u32, 48u64 * 3_600));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(LendingPool, (&admin, &oid, pool_config(), 300u64));
    }));
    assert!(r.is_err(), "300 s timelock rejected on mainnet");
    let pool = LendingPoolClient::new(&env, &env.register(LendingPool, (&admin, &oid, pool_config(), 48u64 * 3_600)));
    let a = Address::generate(&env);
    assert_eq!(err(pool.try_add_reserve(&a, &stable_cfg())), le(LendError::MainnetListing));
    let listing = ReserveConfig {
        ltv_bps: 0,
        collateral_enabled: false,
        ..stable_cfg()
    };
    pool.add_reserve(&a, &listing);
}

// ------------------------------------------------------------------ rounding exploits

#[test]
fn rounding_tiny_supply_withdraw_cannot_extract() {
    let t = setup();
    t.lp(100_000);
    // push the supply index above 1 so rounding matters
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(50_000 * U));
    t.pool.borrow(&b, &t.xlm, &(90_000 * U));
    t.warp(31_536_000 / 3);
    t.refresh();
    t.pool.accrue_interest(&t.xlm);
    let idx = t.pool.reserve(&t.xlm).state.supply_index;
    assert!(idx > SCALE);
    let x = t.user();
    let start = t.bal(&t.xlm, &x);
    t.pool.supply(&x, &t.xlm, &(U + 7)); // min supply + odd amount
    for _ in 0..20 {
        // tiny withdrawals round the burn up
        let r = t.pool.try_withdraw(&x, &t.xlm, &1);
        if r.is_err() {
            break;
        }
    }
    t.pool.withdraw(&x, &t.xlm, &i128::MAX);
    assert!(t.bal(&t.xlm, &x) <= start, "no value extracted by rounding");
    // repeated supply/withdraw-all cycles never gain
    for _ in 0..10 {
        t.pool.supply(&x, &t.xlm, &(U + 3));
        t.pool.withdraw(&x, &t.xlm, &i128::MAX);
    }
    assert!(t.bal(&t.xlm, &x) <= start);
    t.solvent(&t.xlm);
}

#[test]
fn rounding_tiny_borrow_repay_cannot_shrink_debt() {
    let t = setup();
    t.lp(100_000);
    let b = t.user();
    t.pool.supply(&b, &t.usdc, &(10_000 * U));
    t.pool.borrow(&b, &t.xlm, &(10_000 * U));
    t.warp(31_536_000 / 7);
    t.refresh();
    let d0 = t.pool.user_reserve(&b, &t.xlm).borrowed;
    // 1-stroop repays burn floor(1/index) = 0 shares: no debt reduction for free
    let mut paid = 0;
    for _ in 0..10 {
        paid += t.pool.repay(&b, &b, &t.xlm, &1);
    }
    let d1 = t.pool.user_reserve(&b, &t.xlm).borrowed;
    assert!(d0 - d1 <= paid, "debt reduced by more than was paid");
    // borrow is minted with ceil: owing ≥ borrowed
    let c = t.user();
    t.pool.supply(&c, &t.usdc, &(10_000 * U));
    t.pool.borrow(&c, &t.xlm, &(U + 1));
    assert!(t.pool.user_reserve(&c, &t.xlm).borrowed > U);
    t.solvent(&t.xlm);
}

#[test]
fn donations_do_not_move_accounting() {
    let t = setup();
    let lp = t.lp(1_000);
    let before = t.pool.reserve(&t.usdc);
    let d = t.user();
    TokenClient::new(&t.env, &t.usdc).transfer(&d, &t.pool.address, &(1_000_000 * U));
    let after = t.pool.reserve(&t.usdc);
    assert_eq!(before.state, after.state, "cash is tracked, not read from balance");
    assert_eq!(t.pool.user_reserve(&lp, &t.usdc).supplied, 1_000 * U);
}

#[test]
fn same_asset_debt_and_collateral_liquidation() {
    let t = setup();
    t.lp(100_000);
    let b = t.user();
    t.pool.supply(&b, &t.shx, &(100_000 * U)); // $500 at thr 40 % = $200
    t.pool.supply(&b, &t.usdc, &(100 * U)); // $85
    t.pool.borrow(&b, &t.usdc, &(200 * U)); // limit 150 + 80 = 230
    t.px(&t.shx, P / 1_000); // $0.001 → SHX $100 × 0.4 = 40 + 85 < 200
    let liq = t.user();
    let (r, s) = t.pool.liquidate(&liq, &b, &t.usdc, &t.usdc, &(50 * U), &false);
    assert_eq!(r, 50 * U);
    assert_eq!(s, 525 * U / 10);
    assert_eq!(t.pool.user_reserve(&b, &t.usdc).supplied, 100 * U - s);
    assert_eq!(t.pool.user_reserve(&b, &t.usdc).borrowed, 150 * U);
    t.solvent(&t.usdc);
}

#[test]
fn risk_reducing_predicate() {
    let o = stable_cfg();
    assert!(is_risk_reducing(&o, &o));
    assert!(is_risk_reducing(&o, &ReserveConfig { ltv_bps: 0, collateral_enabled: false, ..o.clone() }));
    assert!(!is_risk_reducing(&o, &ReserveConfig { liq_threshold_bps: 8_000, ..o.clone() }));
    assert!(!is_risk_reducing(&o, &ReserveConfig { supply_cap: o.supply_cap + 1, ..o.clone() }));
    assert!(!is_risk_reducing(&o, &ReserveConfig { reserve_factor_bps: 0, ..o.clone() }));
}
