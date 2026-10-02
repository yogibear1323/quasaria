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
    Address, Env, IntoVal, InvokeError, Symbol, Val,
};

const DELAY: u64 = 600;
/// Stake amounts are in 7-decimal units; 1 token = 10_000_000.
const TOK: i128 = 10_000_000;
const MIN: i128 = MIN_STAKE_FLOOR;

struct T {
    env: Env,
    c: StakingClient<'static>,
    stake: Address,
    reward: Address,
    admin: Address,
}

/// Queue `action`, wait out the timelock, execute it.
fn exec(env: &Env, c: &StakingClient, action: &StakingAction) {
    let eta = c.propose_action(action);
    env.ledger().set_timestamp(eta);
    c.execute_action(action);
}

fn params(stake: &Address, reward: &Address, rate: i128, lock: u64, min: i128) -> PoolParams {
    PoolParams {
        stake_token: stake.clone(),
        reward_token: reward.clone(),
        reward_rate: rate,
        lock_seconds: lock,
        min_stake: min,
    }
}

/// Add a pool through the timelock; returns its id.
fn add_pool(env: &Env, c: &StakingClient, p: PoolParams) -> u32 {
    let id = c.pool_count();
    exec(env, c, &StakingAction::AddPool(p));
    id
}

fn setup(lock: u64) -> (T, u32) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000 - DELAY);
    let admin = Address::generate(&env);
    let stake = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let reward = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let id = env.register(Staking, (&admin, DELAY));
    let c = StakingClient::new(&env, &id);
    let pid = add_pool(&env, &c, params(&stake, &reward, 100, lock, MIN)); // 100 units / second
    assert_eq!(env.ledger().timestamp(), 10_000);
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
    let a = user(&t, TOK);
    let b = user(&t, 3 * TOK);
    t.c.stake(&a, &pid, &TOK);
    warp(&t, 100); // a alone: 10_000
    t.c.stake(&b, &pid, &(3 * TOK));
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
    let a = user(&t, TOK);
    t.c.stake(&a, &pid, &TOK);
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
    let a = user(&t, TOK);
    t.c.stake(&a, &pid, &TOK);
    warp(&t, 86_400);
    assert_eq!(
        t.c.try_unstake(&a, &pid, &TOK),
        Err(Ok(StakingError::Locked.into()))
    );
    // claiming is still allowed during lock
    assert!(t.c.claim(&a, &pid) > 0);
    warp(&t, 6 * 86_400);
    t.c.unstake(&a, &pid, &TOK);
    assert_eq!(TokenClient::new(&t.env, &t.stake).balance(&a), TOK);
    assert_eq!(t.c.pool(&pid).total_staked, 0);
}

#[test]
fn rate_change_and_deactivation() {
    let (t, pid) = setup(0);
    let a = user(&t, TOK);
    t.c.stake(&a, &pid, &TOK);
    // queue the rate change, then it takes effect at execution (10 s later)
    t.c.propose_action(&StakingAction::SetRewardRate(pid, 10));
    warp(&t, DELAY - 10);
    let before = t.c.pending_rewards(&pid, &a);
    warp(&t, 10);
    t.c.execute_action(&StakingAction::SetRewardRate(pid, 10));
    assert_eq!(t.c.pending_rewards(&pid, &a), before + 1_000);
    warp(&t, 10);
    assert_eq!(t.c.pending_rewards(&pid, &a), before + 1_000 + 100);
    let after_rate = before + 1_100;
    // F-18: negative rates rejected (when queued)
    assert_eq!(
        t.c.try_propose_action(&StakingAction::SetRewardRate(pid, -1)),
        Err(Ok(StakingError::InvalidRate.into()))
    );
    t.c.set_active(&pid, &false);
    warp(&t, 100);
    assert_eq!(t.c.pending_rewards(&pid, &a), after_rate);
    let b = user(&t, TOK);
    assert_eq!(
        t.c.try_stake(&b, &pid, &TOK),
        Err(Ok(StakingError::PoolInactive.into()))
    );
    // can still exit
    t.c.unstake(&a, &pid, &TOK);
}

#[test]
fn unknown_pool_and_overdraw() {
    let (t, pid) = setup(0);
    let a = user(&t, MIN);
    assert_eq!(
        t.c.try_stake(&a, &99, &MIN),
        Err(Ok(StakingError::PoolNotFound.into()))
    );
    t.c.stake(&a, &pid, &MIN);
    assert_eq!(
        t.c.try_unstake(&a, &pid, &(MIN + 1)),
        Err(Ok(StakingError::InsufficientStake.into()))
    );
    assert_eq!(t.c.pool_count(), 1);
    let bad = |p: PoolParams| t.c.try_propose_action(&StakingAction::AddPool(p));
    assert_eq!(
        bad(params(&t.stake, &t.reward, -5, 0, MIN)),
        Err(Ok(StakingError::InvalidRate.into()))
    );
    assert_eq!(
        bad(params(&t.stake, &t.reward, 5, 0, MIN_STAKE_FLOOR - 1)),
        Err(Ok(StakingError::InvalidMinStake.into()))
    );
    assert_eq!(
        bad(params(&t.stake, &t.reward, 5, MAX_LOCK_SECONDS + 1, MIN)),
        Err(Ok(StakingError::LockTooLong.into()))
    );
}

// ------------------------------------------------------------------ F-04

/// Regression F-04 (PoC scenario): a 1-unit stake in an empty pool used to
/// push `acc_reward_per_share` to 1e28 so that every later normal-sized stake
/// overflowed and reverted. Dust stakes are now rejected and the victim's
/// stake succeeds.
#[test]
fn regression_f04_tiny_stake_cannot_brick_pool() {
    let (t, pid) = setup(0);
    StellarAssetClient::new(&t.env, &t.reward).mint(&t.admin, &10_000_000_000);
    t.c.fund(&t.admin, &pid, &10_000_000_000);
    let attacker = user(&t, MIN);
    assert_eq!(
        t.c.try_stake(&attacker, &pid, &1),
        Err(Ok(StakingError::BelowMinStake.into()))
    );
    // the smallest allowed stake, left alone for the whole reserve
    t.c.stake(&attacker, &pid, &MIN);
    warp(&t, 100_000_000);
    let victim = user(&t, 100_000_000_000); // 10,000 tokens
    t.c.stake(&victim, &pid, &100_000_000_000);
    assert_eq!(t.c.position(&pid, &victim).amount, 100_000_000_000);
    // and everyone can still exit / claim
    t.c.claim(&attacker, &pid);
    t.c.unstake(&victim, &pid, &100_000_000_000);
    t.c.unstake(&attacker, &pid, &MIN);
}

/// Regression F-04: partial unstakes cannot leave a dust position behind.
#[test]
fn regression_f04_unstake_cannot_leave_dust() {
    let (t, pid) = setup(0);
    let a = user(&t, 10 * TOK);
    t.c.stake(&a, &pid, &(10 * TOK));
    assert_eq!(
        t.c.try_unstake(&a, &pid, &(10 * TOK - 1)),
        Err(Ok(StakingError::BelowMinStake.into()))
    );
    t.c.unstake(&a, &pid, &(10 * TOK - MIN)); // leaves exactly min
    t.c.unstake(&a, &pid, &MIN); // full exit always allowed
}

/// Regression F-04: extreme but token-representable values (i64::MAX stake,
/// maximal accumulator from a min-size stake and a huge reserve) settle
/// without overflow thanks to 256-bit intermediate math.
#[test]
fn regression_f04_extreme_values_do_not_overflow() {
    let (t, pid) = setup(0);
    let huge: i128 = i64::MAX as i128; // SAC balances are bounded by i64
    StellarAssetClient::new(&t.env, &t.reward).mint(&t.admin, &huge);
    exec(&t.env, &t.c, &StakingAction::SetRewardRate(pid, huge));
    t.c.fund(&t.admin, &pid, &huge);
    let small = user(&t, MIN);
    t.c.stake(&small, &pid, &MIN);
    warp(&t, 10);
    let acc = t.c.pool(&pid).acc_reward_per_share;
    assert!(acc > 1_000_000_000_000_000_000_000_000_000_000, "acc {acc}");
    let whale = user(&t, huge);
    t.c.stake(&whale, &pid, &huge);
    warp(&t, 10);
    t.c.claim(&whale, &pid);
    t.c.claim(&small, &pid);
    t.c.unstake(&whale, &pid, &huge);
}

// ------------------------------------------------------------------ governance / F-08

#[test]
fn pause_blocks_stake_but_not_exits() {
    let (t, pid) = setup(0);
    let guardian = Address::generate(&t.env);
    exec(&t.env, &t.c, &StakingAction::SetGuardian(guardian.clone()));
    let a = user(&t, 2 * TOK);
    t.c.stake(&a, &pid, &TOK);
    warp(&t, 10);
    t.c.pause(&guardian);
    assert_eq!(t.c.try_stake(&a, &pid, &TOK), Err(Ok(GovError::Paused.into())));
    assert!(t.c.claim(&a, &pid) > 0);
    t.c.unstake(&a, &pid, &TOK);
    t.c.unpause();
    t.c.stake(&a, &pid, &TOK);
}

#[test]
fn two_step_admin_and_timelock() {
    let (t, _) = setup(0);
    let ms = Address::generate(&t.env);
    t.c.propose_admin(&ms);
    assert_eq!(t.c.admin(), t.admin);
    t.c.accept_admin();
    assert_eq!(t.c.admin(), ms);
    let a = StakingAction::SetDelay(1_200);
    t.c.propose_action(&a);
    assert_eq!(t.c.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
    warp(&t, DELAY);
    t.c.execute_action(&a);
    assert_eq!(t.c.timelock_delay(), 1_200);
}

/// Regression F-08: the instance TTL is extended (it never was before) and
/// pool/position entries are re-bumped on use.
#[test]
fn regression_f08_ttl_extended() {
    let (t, pid) = setup(0);
    let a = user(&t, TOK);
    t.c.stake(&a, &pid, &TOK);
    let seq = t.env.ledger().sequence();
    t.env.ledger().set_sequence_number(
        seq + quasaria_gov::PERSISTENT_BUMP_TO - quasaria_gov::PERSISTENT_BUMP_THRESHOLD + 10,
    );
    t.c.claim(&a, &pid);
    t.env.as_contract(&t.c.address, || {
        assert!(t.env.storage().instance().get_ttl() >= quasaria_gov::INSTANCE_BUMP_TO - 1);
        assert!(
            t.env.storage().persistent().get_ttl(&DataKey::Pool(pid))
                >= quasaria_gov::PERSISTENT_BUMP_TO - 1
        );
        assert!(
            t.env.storage().persistent().get_ttl(&DataKey::Position(pid, a.clone()))
                >= quasaria_gov::PERSISTENT_BUMP_TO - 1
        );
    });
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
            10_000_000_000_000i128,
            DELAY,
        ),
    );
    let qfx = QuasariaFluxClient::new(&env, &qfx_id);
    let staking_id = env.register(Staking, (&admin, DELAY));
    let c = StakingClient::new(&env, &staking_id);
    let ex = quasaria_reward_token::QfxAction::SetYieldExempt(staking_id.clone(), true);
    let eta = qfx.propose_action(&ex);
    env.ledger().set_timestamp(eta);
    qfx.execute_action(&ex);
    let pid = add_pool(&env, &c, params(&qfx_id, &qfx_id, 1_000_000, 0, MIN));

    let peg = || {
        let r = qfx.reserves();
        assert_eq!(r.xlm_reserve, r.total_supply, "reserve == supply");
        assert_eq!(xlm_t.balance(&qfx_id), qfx.total_supply());
    };

    // Reward reserve: admin deposits XLM -> QFX and funds the pool.
    xlm_admin.mint(&admin, &1_000_000_000);
    qfx.deposit(&admin, &1_000_000_000);
    c.fund(&admin, &pid, &1_000_000_000);
    peg();
    let supply_after_funding = qfx.total_supply();

    let a = Address::generate(&env);
    xlm_admin.mint(&a, &50_000_000);
    qfx.deposit(&a, &50_000_000);
    c.stake(&a, &pid, &50_000_000);
    warp_env(&env, 600); // 600 * 1_000_000 reward
    assert_eq!(c.pending_rewards(&pid, &a), 600_000_000);
    assert_eq!(c.claim(&a, &pid), 600_000_000);
    peg();
    assert_eq!(
        qfx.total_supply(),
        supply_after_funding + 50_000_000,
        "claiming rewards mints nothing"
    );
    warp_env(&env, 10_000); // reserve (400M left) runs dry
    assert_eq!(c.claim(&a, &pid), 400_000_000);
    assert_eq!(c.pool(&pid).reward_reserve, 0);
    c.unstake(&a, &pid, &50_000_000);
    // a redeems stake + all rewards for XLM 1:1 (a earns no holder yield on
    // the stake while it sits in the exempt staking contract, but may have
    // earned a little on its wallet balance between claims)
    let bal = qfx.balance(&a);
    assert!(bal >= 1_050_000_000);
    qfx.redeem(&a, &bal);
    assert_eq!(xlm_t.balance(&a), bal);
    peg();
    assert_eq!(qfx.balance(&staking_id), 0);
}

fn warp_env(env: &Env, secs: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + secs);
}

// ------------------------------------------------------------------ Step 1: timelocked setters

fn assert_no_entrypoint(env: &Env, c: &Address, name: &str, args: soroban_sdk::Vec<Val>) {
    let r = env.try_invoke_contract::<Val, InvokeError>(c, &Symbol::new(env, name), args);
    assert!(r.is_err(), "instant `{name}` must not exist");
}

#[test]
fn step1_instant_setters_rejected() {
    let (t, pid) = setup(0);
    let e = &t.env;
    let g = Address::generate(e);
    assert_no_entrypoint(e, &t.c.address, "set_guardian", (g.clone(),).into_val(e));
    assert_no_entrypoint(
        e,
        &t.c.address,
        "add_pool",
        (t.stake.clone(), t.reward.clone(), 5i128, 0u64, MIN).into_val(e),
    );
    assert_no_entrypoint(e, &t.c.address, "set_reward_rate", (pid, 5i128).into_val(e));
    assert_eq!(t.c.pool_count(), 1);
    assert_eq!(t.c.pool(&pid).reward_rate, 100);
    // set_active(false) stays instant; set_active(true) must use the timelock
    t.c.set_active(&pid, &false);
    assert!(!t.c.pool(&pid).active);
    assert_eq!(t.c.try_set_active(&pid, &true), Err(Ok(GovError::UseTimelock.into())));
    assert!(!t.c.pool(&pid).active);
    exec(e, &t.c, &StakingAction::Activate(pid));
    assert!(t.c.pool(&pid).active);
}

#[test]
fn step1_add_pool_and_rate_queue_wait_execute() {
    let (t, _) = setup(0);
    let p = StakingAction::AddPool(params(&t.stake, &t.reward, 7, 0, MIN));
    let eta = t.c.propose_action(&p);
    assert_eq!(eta, t.env.ledger().timestamp() + DELAY);
    assert_eq!(t.c.action_delay(&p), DELAY);
    assert_eq!(t.c.try_execute_action(&p), Err(Ok(GovError::TimelockNotReady.into())));
    assert_eq!(t.c.pool_count(), 1);
    warp(&t, DELAY);
    t.c.execute_action(&p);
    assert_eq!(t.c.pool_count(), 2);
    assert_eq!(t.c.pool(&1).reward_rate, 7);
    let r = StakingAction::SetRewardRate(1, 9);
    t.c.propose_action(&r);
    assert_eq!(t.c.try_execute_action(&r), Err(Ok(GovError::TimelockNotReady.into())));
    warp(&t, DELAY);
    t.c.execute_action(&r);
    assert_eq!(t.c.pool(&1).reward_rate, 9);
    // rate change on an unknown pool fails at execution
    let unknown = StakingAction::SetRewardRate(42, 1);
    t.c.propose_action(&unknown);
    warp(&t, DELAY);
    assert_eq!(t.c.try_execute_action(&unknown), Err(Ok(StakingError::PoolNotFound.into())));
}

#[test]
fn step1_guardian_cancels_queued_actions() {
    let (t, pid) = setup(0);
    let g = Address::generate(&t.env);
    exec(&t.env, &t.c, &StakingAction::SetGuardian(g.clone()));
    assert_eq!(t.c.guardian(), g);
    let evil = StakingAction::SetRewardRate(pid, 1_000_000);
    let swap = StakingAction::SetGuardian(Address::generate(&t.env));
    let pool = StakingAction::AddPool(params(&t.stake, &t.reward, 1, 0, MIN));
    for a in [&evil, &swap, &pool] {
        t.c.propose_action(a);
        t.c.cancel_action(&g, a);
    }
    warp(&t, DELAY);
    for a in [&evil, &swap, &pool] {
        assert_eq!(t.c.try_execute_action(a), Err(Ok(GovError::NotQueued.into())));
    }
    assert_eq!(t.c.guardian(), g);
    assert_eq!(t.c.pool(&pid).reward_rate, 100);
    assert_eq!(t.c.pool_count(), 1);
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
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(Staking, (&admin, DELAY));
    }));
    assert!(r.is_err(), "300 s rejected on mainnet");
    let c = StakingClient::new(&env, &env.register(Staking, (&admin, 48u64 * 3_600)));
    let tok = Address::generate(&env);
    assert_eq!(c.action_delay(&StakingAction::AddPool(params(&tok, &tok, 1, 0, MIN))), 48 * 3_600);
    assert_eq!(c.action_delay(&StakingAction::SetRewardRate(0, 1)), 48 * 3_600);
    assert_eq!(c.action_delay(&StakingAction::SetGuardian(tok.clone())), 48 * 3_600);
    assert_eq!(c.action_delay(&StakingAction::Activate(0)), 48 * 3_600);
    assert_eq!(c.action_delay(&StakingAction::Upgrade(BytesN::from_array(&env, &[0; 32]))), 72 * 3_600);
    assert_eq!(c.action_delay(&StakingAction::SetDelay(49 * 3_600)), 72 * 3_600);
}
