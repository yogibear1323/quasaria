#![cfg(test)]
extern crate std;

use super::*;
use quasaria_amm_pool::{AmmPool, AmmPoolClient};
use quasaria_referral::{ReferralRegistry, ReferralRegistryClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env,
};

fn sac(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

#[test]
fn two_hop_swap_via_router_with_referral() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(400);
    let admin = Address::generate(&env);
    let xlm = sac(&env, &admin);
    let usdc = sac(&env, &admin);
    let qfx = sac(&env, &admin);
    let reg_id = env.register(ReferralRegistry, (&admin, 2_000u32, 600u64));
    let reg = ReferralRegistryClient::new(&env, &reg_id);
    let p1 = env.register(AmmPool, (&admin, &xlm, &usdc, 30u32, Some(reg_id.clone()), 600u64));
    let p2 = env.register(AmmPool, (&admin, &usdc, &qfx, 30u32, Some(reg_id.clone()), 600u64));
    // fee sources are approved through the referral timelock (600 s)
    let a1 = quasaria_referral::ReferralAction::SetFeeSource(p1.clone(), true);
    let a2 = quasaria_referral::ReferralAction::SetFeeSource(p2.clone(), true);
    reg.propose_action(&a1);
    reg.propose_action(&a2);
    env.ledger().set_timestamp(1_000);
    reg.execute_action(&a1);
    reg.execute_action(&a2);

    let lp = Address::generate(&env);
    let user = Address::generate(&env);
    let referrer = Address::generate(&env);
    for t in [&xlm, &usdc, &qfx] {
        StellarAssetClient::new(&env, t).mint(&lp, &10_000_000_000);
    }
    StellarAssetClient::new(&env, &xlm).mint(&user, &1_000_000_000);
    AmmPoolClient::new(&env, &p1).deposit(&lp, &4_000_000_000, &1_000_000_000, &0, &0);
    AmmPoolClient::new(&env, &p2).deposit(&lp, &1_000_000_000, &2_000_000_000, &0, &0);
    reg.set_referrer(&user, &referrer);

    let router_id = env.register(Router, ());
    let router = RouterClient::new(&env, &router_id);
    let path = vec![&env, p1.clone(), p2.clone()];
    let quote = router.get_amounts_out(&path, &xlm, &100_000_000);
    assert_eq!(quote.len(), 3);
    let expected = quote.get(2).unwrap();

    let out = router.swap_exact_in(&user, &path, &xlm, &100_000_000, &expected, &2_000);
    assert_eq!(out, expected);
    assert_eq!(TokenClient::new(&env, &qfx).balance(&user), out);
    assert_eq!(TokenClient::new(&env, &xlm).balance(&user), 900_000_000);
    // router holds nothing
    assert_eq!(TokenClient::new(&env, &usdc).balance(&router_id), 0);
    // referrer earned on both hops (in each hop's input token)
    assert!(TokenClient::new(&env, &xlm).balance(&referrer) > 0);
    assert!(TokenClient::new(&env, &usdc).balance(&referrer) > 0);
}

#[test]
fn deadline_and_slippage_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(5_000);
    let admin = Address::generate(&env);
    let a = sac(&env, &admin);
    let b = sac(&env, &admin);
    let p = env.register(AmmPool, (&admin, &a, &b, 30u32, None::<Address>, 600u64));
    let lp = Address::generate(&env);
    StellarAssetClient::new(&env, &a).mint(&lp, &10_000_000_000);
    StellarAssetClient::new(&env, &b).mint(&lp, &10_000_000_000);
    AmmPoolClient::new(&env, &p).deposit(&lp, &1_000_000_000, &1_000_000_000, &0, &0);
    let router = RouterClient::new(&env, &env.register(Router, ()));
    let path = vec![&env, p.clone()];
    assert_eq!(
        router.try_swap_exact_in(&lp, &path, &a, &1_000, &0, &4_999),
        Err(Ok(RouterError::Expired.into()))
    );
    assert_eq!(
        router.try_swap_exact_in(&lp, &path, &a, &1_000_000, &1_000_000, &6_000),
        Err(Ok(RouterError::Slippage.into()))
    );
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    assert_eq!(
        router.try_swap_exact_in(&lp, &empty, &a, &1, &0, &6_000),
        Err(Ok(RouterError::EmptyPath.into()))
    );
}
