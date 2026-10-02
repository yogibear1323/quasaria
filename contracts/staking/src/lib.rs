//! # Quasaria staking ("Orbit" pools)
//!
//! * Admin whitelists staking pools: `(stake_token, reward_token,
//!   reward_rate per second, lock_seconds, min_stake)`.
//! * Rewards are streamed MasterChef-style using an accumulated
//!   reward-per-share value (1e18 fixed point), so every staker is settled in
//!   O(1).
//! * **Funding model:** rewards are *pre-funded* by anyone via `fund`; only
//!   funded rewards are ever distributed (emission stops when the reserve runs
//!   dry — no unbacked promises). Staking never mints. For QFX rewards the
//!   reserve is created by depositing testnet XLM into the QFX wrapper
//!   (`qfx.deposit`, 1 QFX = 1 XLM, fully backed) and/or by routing fees in,
//!   then calling `fund`; so every QFX paid out is backed 1:1 by XLM. The
//!   staking contract should be marked `yield_exempt` on QFX so the token's
//!   holder yield is not stranded in its balance.
//! * Optional lock: each stake resets `unlock_at = max(unlock_at, now + lock)`;
//!   `unstake` before that reverts. Claiming is always allowed.
//!
//! ## Overflow safety (F-04)
//! A position must hold at least the pool's `min_stake` (≥ [`MIN_STAKE_FLOOR`])
//! — both after staking and after a partial unstake — which bounds the
//! accumulator growth per reward unit, and every product is computed with
//! checked / 256-bit arithmetic (`quasaria_gov::mul_div_floor`), so no stake
//! size can make `amount * acc` overflow and brick the pool.
//!
//! ## Governance
//! Two-step admin transfer; guardian pause blocks `stake` only (unstake and
//! claim always work). Timelocked (`propose_action` -> delay ->
//! `execute_action`): `AddPool`, `SetRewardRate`, `Activate`, `SetGuardian`
//! (48 h class on mainnet) and `Upgrade` / `SetDelay` (72 h class). Only the
//! risk-reducing `set_active(pool, false)` is instant. Instance and
//! persistent TTLs are extended on every read and write.
#![no_std]

use quasaria_gov as gov;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, Env,
};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria Orbit staking");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

const ACC: i128 = 1_000_000_000_000_000_000;
pub const MAX_LOCK_SECONDS: u64 = 365 * 86_400;
/// Smallest `min_stake` a pool may be configured with (0.1 unit at 7 decimals).
pub const MIN_STAKE_FLOOR: i128 = 1_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StakingError {
    PoolNotFound = 1,
    PoolInactive = 2,
    ZeroAmount = 3,
    Locked = 4,
    InsufficientStake = 5,
    LockTooLong = 6,
    BelowMinStake = 7,
    InvalidRate = 8,
    InvalidMinStake = 9,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pool {
    pub stake_token: Address,
    pub reward_token: Address,
    pub reward_rate: i128,
    pub lock_seconds: u64,
    pub total_staked: i128,
    pub acc_reward_per_share: i128,
    pub last_update: u64,
    pub reward_reserve: i128,
    pub active: bool,
    /// Minimum position size (stake-token units).
    pub min_stake: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct Position {
    pub amount: i128,
    pub reward_debt: i128,
    pub pending: i128,
    pub unlock_at: u64,
}

/// Parameters of a new staking pool (`StakingAction::AddPool`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolParams {
    pub stake_token: Address,
    pub reward_token: Address,
    /// Reward units per second.
    pub reward_rate: i128,
    pub lock_seconds: u64,
    pub min_stake: i128,
}

/// Timelocked admin actions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StakingAction {
    Upgrade(BytesN<32>),
    SetDelay(u64),
    SetGuardian(Address),
    /// Whitelist a new pool (id = `pool_count()` at execution).
    AddPool(PoolParams),
    /// (pool_id, reward_rate)
    SetRewardRate(u32, i128),
    /// Re-activate a pool deactivated with `set_active(pool, false)`.
    Activate(u32),
}

impl gov::TimelockAction for StakingAction {
    fn delay_class(&self) -> gov::DelayClass {
        match self {
            StakingAction::Upgrade(_) | StakingAction::SetDelay(_) => gov::DelayClass::Critical,
            StakingAction::SetGuardian(_)
            | StakingAction::AddPool(_)
            | StakingAction::SetRewardRate(_, _)
            | StakingAction::Activate(_) => gov::DelayClass::Standard,
        }
    }
    fn validate(&self, env: &Env) {
        match self {
            StakingAction::AddPool(p) => check_params(env, p),
            StakingAction::SetRewardRate(_, r) => check_rate(env, *r),
            StakingAction::SetDelay(d) => gov::check_delay(env, *d),
            _ => {}
        }
    }
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    PoolCount,
    Pool(u32),
    Position(u32, Address),
}

#[contractevent(topics = ["staked"])]
pub struct Staked {
    #[topic]
    pub user: Address,
    #[topic]
    pub pool_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["unstaked"])]
pub struct Unstaked {
    #[topic]
    pub user: Address,
    #[topic]
    pub pool_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["claimed"])]
pub struct Claimed {
    #[topic]
    pub user: Address,
    #[topic]
    pub pool_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["pool_set"])]
pub struct PoolSet {
    #[topic]
    pub pool_id: u32,
    pub reward_rate: i128,
    pub active: bool,
}

#[contractevent(topics = ["funded"])]
pub struct Funded {
    #[topic]
    pub from: Address,
    #[topic]
    pub pool_id: u32,
    pub amount: i128,
}

#[contract]
pub struct Staking;

fn load_pool(env: &Env, id: u32) -> Pool {
    let k = DataKey::Pool(id);
    let p = env
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(env, StakingError::PoolNotFound));
    gov::bump_persistent(env, &k);
    p
}

fn save_pool(env: &Env, id: u32, p: &Pool) {
    let k = DataKey::Pool(id);
    env.storage().persistent().set(&k, p);
    gov::bump_persistent(env, &k);
}

fn load_pos(env: &Env, id: u32, user: &Address) -> Position {
    let k = DataKey::Position(id, user.clone());
    let p = env.storage().persistent().get(&k).unwrap_or_default();
    gov::bump_persistent(env, &k);
    p
}

fn save_pos(env: &Env, id: u32, user: &Address, p: &Position) {
    let k = DataKey::Position(id, user.clone());
    env.storage().persistent().set(&k, p);
    gov::bump_persistent(env, &k);
}

/// Advance the pool's accumulator to `now` (pure: returns updated copy).
fn updated(env: &Env, pool: &Pool, now: u64) -> Pool {
    let mut p = pool.clone();
    if now <= p.last_update {
        return p;
    }
    if p.total_staked > 0 && p.active && p.reward_rate > 0 && p.reward_reserve > 0 {
        let elapsed = i128::from(now.saturating_sub(p.last_update));
        let mut reward = p.reward_rate.saturating_mul(elapsed);
        if reward > p.reward_reserve {
            reward = p.reward_reserve;
        }
        let inc = gov::mul_div_floor(env, reward, ACC, p.total_staked);
        p.acc_reward_per_share = gov::add(env, p.acc_reward_per_share, inc);
        p.reward_reserve = gov::sub(env, p.reward_reserve, reward);
    }
    p.last_update = now;
    p
}

fn debt_of(env: &Env, amount: i128, acc: i128) -> i128 {
    gov::mul_div_floor(env, amount, acc, ACC)
}

fn settle(env: &Env, pool: &Pool, pos: &mut Position) {
    let accrued = gov::sub(env, debt_of(env, pos.amount, pool.acc_reward_per_share), pos.reward_debt);
    if accrued > 0 {
        pos.pending = gov::add(env, pos.pending, accrued);
    }
}

fn check_rate(env: &Env, reward_rate: i128) {
    if reward_rate < 0 {
        panic_with_error!(env, StakingError::InvalidRate);
    }
}

fn check_params(env: &Env, p: &PoolParams) {
    if p.lock_seconds > MAX_LOCK_SECONDS {
        panic_with_error!(env, StakingError::LockTooLong);
    }
    check_rate(env, p.reward_rate);
    if p.min_stake < MIN_STAKE_FLOOR {
        panic_with_error!(env, StakingError::InvalidMinStake);
    }
}

fn add_pool_now(env: &Env, params: PoolParams) -> u32 {
    check_params(env, &params);
    let id: u32 = env.storage().instance().get(&DataKey::PoolCount).unwrap_or(0);
    let p = Pool {
        stake_token: params.stake_token,
        reward_token: params.reward_token,
        reward_rate: params.reward_rate,
        lock_seconds: params.lock_seconds,
        total_staked: 0,
        acc_reward_per_share: 0,
        last_update: env.ledger().timestamp(),
        reward_reserve: 0,
        active: true,
        min_stake: params.min_stake,
    };
    save_pool(env, id, &p);
    env.storage()
        .instance()
        .set(&DataKey::PoolCount, &id.saturating_add(1));
    PoolSet {
        pool_id: id,
        reward_rate: p.reward_rate,
        active: true,
    }
    .publish(env);
    id
}

fn set_reward_rate_now(env: &Env, pool_id: u32, reward_rate: i128) {
    check_rate(env, reward_rate);
    let mut p = updated(env, &load_pool(env, pool_id), env.ledger().timestamp());
    p.reward_rate = reward_rate;
    save_pool(env, pool_id, &p);
    PoolSet {
        pool_id,
        reward_rate,
        active: p.active,
    }
    .publish(env);
}

fn set_active_now(env: &Env, pool_id: u32, active: bool) {
    let mut p = updated(env, &load_pool(env, pool_id), env.ledger().timestamp());
    p.active = active;
    save_pool(env, pool_id, &p);
    PoolSet {
        pool_id,
        reward_rate: p.reward_rate,
        active,
    }
    .publish(env);
}

quasaria_gov::governance_entrypoints!(Staking, StakingAction);
quasaria_gov::pause_entrypoints!(Staking);

#[contractimpl]
impl Staking {
    pub fn __constructor(env: Env, admin: Address, timelock_delay: u64) {
        gov::init(&env, &admin, timelock_delay);
        env.storage().instance().set(&DataKey::PoolCount, &0u32);
    }

    /// Apply a queued timelocked action after its delay.
    pub fn execute_action(env: Env, action: StakingAction) {
        gov::consume(&env, &action);
        match action {
            StakingAction::Upgrade(hash) => gov::upgrade_now(&env, &hash),
            StakingAction::SetDelay(d) => gov::set_delay_now(&env, d),
            StakingAction::SetGuardian(g) => gov::set_guardian_now(&env, &g),
            StakingAction::AddPool(params) => {
                add_pool_now(&env, params);
            }
            StakingAction::SetRewardRate(pool_id, rate) => set_reward_rate_now(&env, pool_id, rate),
            StakingAction::Activate(pool_id) => set_active_now(&env, pool_id, true),
        }
    }

    /// Instant **deactivation** only (no new stakes, rewards stop; users can
    /// still unstake and claim). Re-activating is risk-increasing and goes
    /// through the timelocked `StakingAction::Activate`.
    pub fn set_active(env: Env, pool_id: u32, active: bool) {
        gov::require_admin(&env);
        if active {
            panic_with_error!(&env, gov::GovError::UseTimelock);
        }
        set_active_now(&env, pool_id, false);
    }

    /// Top up the reward reserve of a pool (anyone may fund).
    pub fn fund(env: Env, from: Address, pool_id: u32, amount: i128) {
        from.require_auth();
        gov::bump_instance(&env);
        if amount <= 0 {
            panic_with_error!(&env, StakingError::ZeroAmount);
        }
        let mut p = updated(&env, &load_pool(&env, pool_id), env.ledger().timestamp());
        token::Client::new(&env, &p.reward_token).transfer(
            &from,
            env.current_contract_address(),
            &amount,
        );
        p.reward_reserve = gov::add(&env, p.reward_reserve, amount);
        save_pool(&env, pool_id, &p);
        Funded {
            from,
            pool_id,
            amount,
        }
        .publish(&env);
    }

    /// Paused by the guardian. The resulting position must be ≥ `min_stake`.
    pub fn stake(env: Env, user: Address, pool_id: u32, amount: i128) {
        user.require_auth();
        gov::bump_instance(&env);
        gov::when_not_paused(&env);
        if amount <= 0 {
            panic_with_error!(&env, StakingError::ZeroAmount);
        }
        let now = env.ledger().timestamp();
        let mut p = updated(&env, &load_pool(&env, pool_id), now);
        if !p.active {
            panic_with_error!(&env, StakingError::PoolInactive);
        }
        let mut pos = load_pos(&env, pool_id, &user);
        let new_amount = gov::add(&env, pos.amount, amount);
        if new_amount < p.min_stake {
            panic_with_error!(&env, StakingError::BelowMinStake);
        }
        settle(&env, &p, &mut pos);
        token::Client::new(&env, &p.stake_token).transfer(
            &user,
            env.current_contract_address(),
            &amount,
        );
        pos.amount = new_amount;
        let unlock = gov::checked_add_u64(&env, now, p.lock_seconds);
        if unlock > pos.unlock_at {
            pos.unlock_at = unlock;
        }
        pos.reward_debt = debt_of(&env, pos.amount, p.acc_reward_per_share);
        p.total_staked = gov::add(&env, p.total_staked, amount);
        save_pool(&env, pool_id, &p);
        save_pos(&env, pool_id, &user, &pos);
        Staked {
            user,
            pool_id,
            amount,
        }
        .publish(&env);
    }

    /// Never paused. A partial unstake may not leave less than `min_stake`.
    pub fn unstake(env: Env, user: Address, pool_id: u32, amount: i128) {
        user.require_auth();
        gov::bump_instance(&env);
        if amount <= 0 {
            panic_with_error!(&env, StakingError::ZeroAmount);
        }
        let now = env.ledger().timestamp();
        let mut p = updated(&env, &load_pool(&env, pool_id), now);
        let mut pos = load_pos(&env, pool_id, &user);
        if now < pos.unlock_at {
            panic_with_error!(&env, StakingError::Locked);
        }
        if pos.amount < amount {
            panic_with_error!(&env, StakingError::InsufficientStake);
        }
        let remaining = gov::sub(&env, pos.amount, amount);
        if remaining > 0 && remaining < p.min_stake {
            panic_with_error!(&env, StakingError::BelowMinStake);
        }
        settle(&env, &p, &mut pos);
        pos.amount = remaining;
        pos.reward_debt = debt_of(&env, pos.amount, p.acc_reward_per_share);
        p.total_staked = gov::sub(&env, p.total_staked, amount);
        save_pool(&env, pool_id, &p);
        save_pos(&env, pool_id, &user, &pos);
        token::Client::new(&env, &p.stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );
        Unstaked {
            user,
            pool_id,
            amount,
        }
        .publish(&env);
    }

    /// Never paused.
    pub fn claim(env: Env, user: Address, pool_id: u32) -> i128 {
        user.require_auth();
        gov::bump_instance(&env);
        let p = updated(&env, &load_pool(&env, pool_id), env.ledger().timestamp());
        let mut pos = load_pos(&env, pool_id, &user);
        settle(&env, &p, &mut pos);
        let amount = pos.pending;
        pos.pending = 0;
        pos.reward_debt = debt_of(&env, pos.amount, p.acc_reward_per_share);
        save_pool(&env, pool_id, &p);
        save_pos(&env, pool_id, &user, &pos);
        if amount > 0 {
            token::Client::new(&env, &p.reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &amount,
            );
            Claimed {
                user,
                pool_id,
                amount,
            }
            .publish(&env);
        }
        amount
    }

    // ---- views

    pub fn pool_count(env: Env) -> u32 {
        gov::bump_instance(&env);
        env.storage().instance().get(&DataKey::PoolCount).unwrap_or(0)
    }

    pub fn pool(env: Env, pool_id: u32) -> Pool {
        updated(&env, &load_pool(&env, pool_id), env.ledger().timestamp())
    }

    pub fn position(env: Env, pool_id: u32, user: Address) -> Position {
        load_pos(&env, pool_id, &user)
    }

    pub fn pending_rewards(env: Env, pool_id: u32, user: Address) -> i128 {
        let p = updated(&env, &load_pool(&env, pool_id), env.ledger().timestamp());
        let mut pos = load_pos(&env, pool_id, &user);
        settle(&env, &p, &mut pos);
        pos.pending
    }
}

#[cfg(test)]
mod test;
