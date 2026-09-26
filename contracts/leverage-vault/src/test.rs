#![cfg(test)]
extern crate std;

use super::*;
use quasaria_mock_oracle::{Asset as OAsset, MockOracle, MockOracleClient};
use quasaria_referral::{ReferralRegistry, ReferralRegistryClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol,
};

const P: i128 = 100_000_000_000_000; // 1.0 with 14 decimals

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
        max_leverage_bps: 100_000, // 10x
        maintenance_margin_bps: 500, // 5%
        liquidation_bonus_bps: 500,  // 5% of margin
        open_fee_bps: 10,            // 0.1% of notional
        max_price_age: 600,
    }
}

fn setup() -> T {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let oracle_id = env.register(MockOracle, (&admin, 14u32));
    let reg_id = env.register(ReferralRegistry, (&admin, 2_000u32));
    let vid = env.register(
        LeverageVault,
        (&admin, &usdc, &oracle_id, Some(reg_id.clone()), config()),
    );
    let reg = ReferralRegistryClient::new(&env, &reg_id);
    reg.set_fee_source(&vid, &true);
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
    // admin cannot exceed hard cap
    let mut c = config();
    c.max_leverage_bps = HARD_MAX_LEVERAGE_BPS + 1;
    assert_eq!(t.v.try_set_config(&c), Err(Ok(VaultError::InvalidConfig.into())));
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
    let id = t.v.open_position(&bot, &u, &xlm(&t.env), &true, &100_000_000, &20_000);
    t.v.set_triggers(&bot, &id, &(P * 90 / 100), &(P * 120 / 100));
    // take profit hit -> any keeper can execute
    assert_eq!(t.v.try_execute_trigger(&id), Err(Ok(VaultError::TriggerNotHit.into())));
    set_price(&t, P * 125 / 100);
    let payout = t.v.execute_trigger(&id);
    assert_eq!(payout, 100_000_000 + 50_000_000);
    assert_eq!(t.v.user_positions(&u).len(), 0);
}

#[test]
fn stale_oracle_rejected_and_profit_capped_by_reserve() {
    let t = setup();
    let u = trader(&t, 10_000_000_000);
    let far = t.env.ledger().timestamp() + 601;
    t.env.ledger().set_timestamp(far);
    assert_eq!(
        t.v.try_open_position(&u, &u, &xlm(&t.env), &true, &100_000_000, &20_000),
        Err(Ok(VaultError::StalePrice.into()))
    );
    set_price(&t, P);
    t.v.withdraw_liquidity(&t.admin, &(t.v.liquidity() - 10_000_000));
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
    assert_eq!(pnl_at(true, 1_000, 100, 110), 100);
    assert_eq!(pnl_at(false, 1_000, 100, 110), -100);
    assert_eq!(health_factor_bps(100, 1_000, -60, 500), 8_000);
    assert_eq!(health_factor_bps(100, 1_000, -200, 500), 0);
}
