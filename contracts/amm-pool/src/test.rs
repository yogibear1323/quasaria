#![cfg(test)]
extern crate std;

use super::*;
use quasaria_referral::{ReferralRegistry, ReferralRegistryClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

struct T {
    env: Env,
    pool: AmmPoolClient<'static>,
    a: TokenClient<'static>,
    b: TokenClient<'static>,
    reg: ReferralRegistryClient<'static>,
}

fn sac(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn setup() -> T {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ta = sac(&env, &admin);
    let tb = sac(&env, &admin);
    let reg_id = env.register(ReferralRegistry, (&admin, 2_000u32)); // 20% of fee
    let pool_id = env.register(
        AmmPool,
        (&admin, &ta, &tb, 30u32, Some(reg_id.clone())),
    );
    let reg = ReferralRegistryClient::new(&env, &reg_id);
    reg.set_fee_source(&pool_id, &true);
    T {
        pool: AmmPoolClient::new(&env, &pool_id),
        a: TokenClient::new(&env, &ta),
        b: TokenClient::new(&env, &tb),
        reg,
        env,
    }
}

fn fund(t: &T, who: &Address, amount: i128) {
    StellarAssetClient::new(&t.env, &t.a.address).mint(who, &amount);
    StellarAssetClient::new(&t.env, &t.b.address).mint(who, &amount);
}

#[test]
fn deposit_mints_lp_and_locks_minimum() {
    let t = setup();
    let lp = Address::generate(&t.env);
    fund(&t, &lp, 1_000_000_000);
    let (a, b, s) = t.pool.deposit(&lp, &100_000_000, &400_000_000, &0, &0);
    assert_eq!((a, b), (100_000_000, 400_000_000));
    assert_eq!(s, 200_000_000 - MINIMUM_LIQUIDITY);
    assert_eq!(t.pool.balance(&lp), s);
    assert_eq!(t.pool.total_shares(), 200_000_000);
    assert_eq!(t.pool.reserves(), (100_000_000, 400_000_000));
    // proportional second deposit uses the optimal ratio
    let lp2 = Address::generate(&t.env);
    fund(&t, &lp2, 1_000_000_000);
    let (a2, b2, s2) = t.pool.deposit(&lp2, &10_000_000, &100_000_000, &0, &0);
    assert_eq!((a2, b2), (10_000_000, 40_000_000));
    assert_eq!(s2, 20_000_000);
}

#[test]
fn swap_constant_product_and_fees_accrue_to_lps() {
    let t = setup();
    let lp = Address::generate(&t.env);
    let trader = Address::generate(&t.env);
    fund(&t, &lp, 10_000_000_000);
    fund(&t, &trader, 10_000_000_000);
    let (_, _, shares) = t.pool.deposit(&lp, &1_000_000_000, &1_000_000_000, &0, &0);
    let k0 = 1_000_000_000i128 * 1_000_000_000;
    let quote = t.pool.get_amount_out(&t.a.address, &10_000_000);
    let out = t.pool.swap(&trader, &trader, &t.a.address, &10_000_000, &quote);
    assert_eq!(out, quote);
    // 10M in, 0.3% fee -> 9.97M net; out = 9.97M*1e9/(1e9+9.97M)
    assert_eq!(out, 9_871_580);
    let (ra, rb) = t.pool.reserves();
    assert!(ra * rb > k0, "k grows by the fee");
    // slippage protection
    let r = t.pool.try_swap(&trader, &trader, &t.a.address, &10_000_000, &100_000_000);
    assert_eq!(r, Err(Ok(PoolError::Slippage.into())));
    // round-trip swaps then withdraw: LP ends with more value than deposited
    for _ in 0..10 {
        let o = t.pool.swap(&trader, &trader, &t.a.address, &50_000_000, &0);
        t.pool.swap(&trader, &trader, &t.b.address, &o, &0);
    }
    let (wa, wb) = t.pool.withdraw(&lp, &shares, &0, &0);
    assert!(wa + wb > 2 * (1_000_000_000 - MINIMUM_LIQUIDITY), "{wa} + {wb}");
}

#[test]
fn referrer_receives_fee_share() {
    let t = setup();
    let lp = Address::generate(&t.env);
    let trader = Address::generate(&t.env);
    let referrer = Address::generate(&t.env);
    fund(&t, &lp, 10_000_000_000);
    fund(&t, &trader, 10_000_000_000);
    t.pool.deposit(&lp, &1_000_000_000, &1_000_000_000, &0, &0);
    t.reg.set_referrer(&trader, &referrer);
    t.pool.swap(&trader, &trader, &t.a.address, &100_000_000, &0);
    // fee = 300_000; referral = 20% = 60_000
    assert_eq!(t.a.balance(&referrer), 60_000);
    assert_eq!(t.reg.earned(&referrer, &t.a.address), 60_000);
    let (ra, _) = t.pool.reserves();
    assert_eq!(ra, 1_000_000_000 + 100_000_000 - 60_000);
    assert_eq!(t.a.balance(&t.pool.address), ra);
}

#[test]
fn lp_token_is_transferable() {
    let t = setup();
    let lp = Address::generate(&t.env);
    let other = Address::generate(&t.env);
    fund(&t, &lp, 1_000_000_000);
    let (_, _, s) = t.pool.deposit(&lp, &100_000_000, &100_000_000, &0, &0);
    t.pool.transfer(&lp, &other, &(s / 2));
    assert_eq!(t.pool.balance(&other), s / 2);
    let (a, b) = t.pool.withdraw(&other, &(s / 2), &0, &0);
    assert!(a > 0 && b > 0);
    assert_eq!(t.pool.symbol(), soroban_sdk::String::from_str(&t.env, "QLP"));
}

#[test]
fn rejects_bad_inputs() {
    let t = setup();
    let u = Address::generate(&t.env);
    fund(&t, &u, 1_000_000);
    assert_eq!(
        t.pool.try_swap(&u, &u, &t.a.address, &1_000, &0),
        Err(Ok(PoolError::InsufficientLiquidity.into()))
    );
    let bogus = Address::generate(&t.env);
    assert_eq!(
        t.pool.try_get_amount_out(&bogus, &1),
        Err(Ok(PoolError::InvalidToken.into()))
    );
    assert_eq!(t.pool.try_set_fee_bps(&101), Err(Ok(PoolError::FeeTooHigh.into())));
}

#[test]
fn sqrt_works() {
    assert_eq!(sqrt(0), 0);
    assert_eq!(sqrt(1), 1);
    assert_eq!(sqrt(15), 3);
    assert_eq!(sqrt(16), 4);
    assert_eq!(sqrt(1_000_000_000_000_000_000), 1_000_000_000);
}
