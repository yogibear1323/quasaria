#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

struct T {
    env: Env,
    c: StakingClient<'static>,
    stake: Address,
    reward: Address,
    admin: Address,
}

fn setup(lock: u64) -> (T, u32) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);
    let admin = Address::generate(&env);
    let stake = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let reward = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let id = env.register(Staking, (&admin,));
    let c = StakingClient::new(&env, &id);
    let pid = c.add_pool(&stake, &reward, &100, &lock); // 100 units / second
    StellarAssetClient::new(&env, &reward).mint(&admin, &1_000_000_000);
    c.fund(&admin, &pid, &1_000_000);
    (
        T {
            env,
            c,
            stake,
            reward,
            admin,
        },
        pid,
    )
}

fn user(t: &T, amount: i128) -> Address {
    let u = Address::generate(&t.env);
    StellarAssetClient::new(&t.env, &t.stake).mint(&u, &amount);
    u
}

fn warp(t: &T, secs: u64) {
    let now = t.env.ledger().timestamp();
    t.env.ledger().set_timestamp(now + secs);
}

#[test]
fn rewards_split_pro_rata() {
    let (t, pid) = setup(0);
    let a = user(&t, 1_000);
    let b = user(&t, 3_000);
    t.c.stake(&a, &pid, &1_000);
    warp(&t, 100); // a alone: 10_000
    t.c.stake(&b, &pid, &3_000);
    warp(&t, 100); // a: 2_500, b: 7_500
    assert_eq!(t.c.pending_rewards(&pid, &a), 12_500);
    assert_eq!(t.c.pending_rewards(&pid, &b), 7_500);
    let got = t.c.claim(&a, &pid);
    assert_eq!(got, 12_500);
    assert_eq!(TokenClient::new(&t.env, &t.reward).balance(&a), 12_500);
    assert_eq!(t.c.pending_rewards(&pid, &a), 0);
}

#[test]
fn emission_limited_to_funded_reserve() {
    let (t, pid) = setup(0);
    let a = user(&t, 1_000);
    t.c.stake(&a, &pid, &1_000);
    warp(&t, 1_000_000); // would be 1e8 but only 1e6 funded
    assert_eq!(t.c.pending_rewards(&pid, &a), 1_000_000);
    assert_eq!(t.c.pool(&pid).reward_reserve, 0);
    t.c.claim(&a, &pid);
    // top-up restarts the stream
    t.c.fund(&t.admin, &pid, &500);
    warp(&t, 10);
    assert_eq!(t.c.pending_rewards(&pid, &a), 500);
}

#[test]
fn lock_period_blocks_early_unstake() {
    let (t, pid) = setup(7 * 86_400);
    let a = user(&t, 1_000);
    t.c.stake(&a, &pid, &1_000);
    warp(&t, 86_400);
    assert_eq!(
        t.c.try_unstake(&a, &pid, &1_000),
        Err(Ok(StakingError::Locked.into()))
    );
    // claiming is still allowed during lock
    assert!(t.c.claim(&a, &pid) > 0);
    warp(&t, 6 * 86_400);
    t.c.unstake(&a, &pid, &1_000);
    assert_eq!(TokenClient::new(&t.env, &t.stake).balance(&a), 1_000);
    assert_eq!(t.c.pool(&pid).total_staked, 0);
}

#[test]
fn rate_change_and_deactivation() {
    let (t, pid) = setup(0);
    let a = user(&t, 1_000);
    t.c.stake(&a, &pid, &1_000);
    warp(&t, 10);
    t.c.set_reward_rate(&pid, &10);
    warp(&t, 10);
    assert_eq!(t.c.pending_rewards(&pid, &a), 1_000 + 100);
    t.c.set_active(&pid, &false);
    warp(&t, 100);
    assert_eq!(t.c.pending_rewards(&pid, &a), 1_100);
    let b = user(&t, 10);
    assert_eq!(
        t.c.try_stake(&b, &pid, &10),
        Err(Ok(StakingError::PoolInactive.into()))
    );
    // can still exit
    t.c.unstake(&a, &pid, &1_000);
}

#[test]
fn unknown_pool_and_overdraw() {
    let (t, pid) = setup(0);
    let a = user(&t, 100);
    assert_eq!(
        t.c.try_stake(&a, &99, &10),
        Err(Ok(StakingError::PoolNotFound.into()))
    );
    t.c.stake(&a, &pid, &100);
    assert_eq!(
        t.c.try_unstake(&a, &pid, &101),
        Err(Ok(StakingError::InsufficientStake.into()))
    );
    assert_eq!(t.c.pool_count(), 1);
}

/// Integration: QFX (1:1 XLM wrapper) as stake + reward token. Rewards come
/// from a reserve created by depositing XLM, so the peg holds throughout.
#[test]
fn qfx_rewards_come_from_xlm_backed_reserve() {
    use quasaria_reward_token::{QuasariaFlux, QuasariaFluxClient};
    use soroban_sdk::String;
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);
    let admin = Address::generate(&env);
    let xlm = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let xlm_admin = StellarAssetClient::new(&env, &xlm);
    let xlm_t = TokenClient::new(&env, &xlm);
    let qfx_id = env.register(
        QuasariaFlux,
        (
            &admin,
            &xlm,
            String::from_str(&env, "Quasaria Flux"),
            String::from_str(&env, "QFX"),
            1_200u32,
        ),
    );
    let qfx = QuasariaFluxClient::new(&env, &qfx_id);
    let staking_id = env.register(Staking, (&admin,));
    let c = StakingClient::new(&env, &staking_id);
    qfx.set_yield_exempt(&staking_id, &true);
    let pid = c.add_pool(&qfx_id, &qfx_id, &1_000, &0);

    let peg = || {
        let r = qfx.reserves();
        assert_eq!(r.xlm_reserve, r.total_supply, "reserve == supply");
        assert_eq!(xlm_t.balance(&qfx_id), qfx.total_supply());
    };

    // Reward reserve: admin deposits 1,000,000 stroops of XLM -> QFX and funds the pool.
    xlm_admin.mint(&admin, &1_000_000);
    qfx.deposit(&admin, &1_000_000);
    c.fund(&admin, &pid, &1_000_000);
    peg();
    let supply_after_funding = qfx.total_supply();

    let a = Address::generate(&env);
    xlm_admin.mint(&a, &50_000);
    qfx.deposit(&a, &50_000);
    c.stake(&a, &pid, &50_000);
    warp_env(&env, 600); // 600 * 1_000 = 600_000 reward
    assert_eq!(c.pending_rewards(&pid, &a), 600_000);
    assert_eq!(c.claim(&a, &pid), 600_000);
    peg();
    assert_eq!(
        qfx.total_supply(),
        supply_after_funding + 50_000,
        "claiming rewards mints nothing"
    );
    warp_env(&env, 10_000); // reserve (400_000 left) runs dry
    assert_eq!(c.claim(&a, &pid), 400_000);
    assert_eq!(c.pool(&pid).reward_reserve, 0);
    c.unstake(&a, &pid, &50_000);
    // a redeems stake + all rewards for XLM 1:1
    let bal = qfx.balance(&a);
    assert_eq!(bal, 1_050_000);
    qfx.redeem(&a, &bal);
    assert_eq!(xlm_t.balance(&a), 1_050_000);
    peg();
    assert_eq!(qfx.balance(&staking_id), 0);
}

fn warp_env(env: &Env, secs: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + secs);
}
