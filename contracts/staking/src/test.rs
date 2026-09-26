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
