//! # Quasaria staking ("Orbit" pools)
//!
//! * Admin whitelists staking pools: `(stake_token, reward_token,
//!   reward_rate per second, lock_seconds)`.
//! * Rewards are streamed MasterChef-style using an accumulated
//!   reward-per-share value (1e18 fixed point), so every staker is settled in
//!   O(1).
//! * **Funding model:** rewards are *pre-funded* by anyone via `fund`; only
//!   funded rewards are ever distributed (emission stops when the reserve runs
//!   dry — no unbacked promises).
//! * Optional lock: each stake resets `unlock_at = max(unlock_at, now + lock)`;
//!   `unstake` before that reverts. Claiming is always allowed.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env,
};

const ACC: i128 = 1_000_000_000_000_000_000;
const DAY_LEDGERS: u32 = 17_280;
pub const MAX_LOCK_SECONDS: u64 = 365 * 86_400;

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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct Position {
    pub amount: i128,
    pub reward_debt: i128,
    pub pending: i128,
    pub unlock_at: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
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

#[contract]
pub struct Staking;

fn admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn load_pool(env: &Env, id: u32) -> Pool {
    env.storage()
        .persistent()
        .get(&DataKey::Pool(id))
        .unwrap_or_else(|| panic_with_error!(env, StakingError::PoolNotFound))
}

fn save_pool(env: &Env, id: u32, p: &Pool) {
    let k = DataKey::Pool(id);
    env.storage().persistent().set(&k, p);
    env.storage()
        .persistent()
        .extend_ttl(&k, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
}

fn load_pos(env: &Env, id: u32, user: &Address) -> Position {
    env.storage()
        .persistent()
        .get(&DataKey::Position(id, user.clone()))
        .unwrap_or_default()
}

fn save_pos(env: &Env, id: u32, user: &Address, p: &Position) {
    let k = DataKey::Position(id, user.clone());
    env.storage().persistent().set(&k, p);
    env.storage()
        .persistent()
        .extend_ttl(&k, 30 * DAY_LEDGERS, 120 * DAY_LEDGERS);
}

/// Advance the pool's accumulator to `now` (pure: returns updated copy).
fn updated(pool: &Pool, now: u64) -> Pool {
    let mut p = pool.clone();
    if now <= p.last_update {
        return p;
    }
    if p.total_staked > 0 && p.active {
        let elapsed = (now - p.last_update) as i128;
        let mut reward = p.reward_rate * elapsed;
        if reward > p.reward_reserve {
            reward = p.reward_reserve;
        }
        p.acc_reward_per_share += reward * ACC / p.total_staked;
        p.reward_reserve -= reward;
    }
    p.last_update = now;
    p
}

fn settle(pool: &Pool, pos: &mut Position) {
    let accrued = pos.amount * pool.acc_reward_per_share / ACC - pos.reward_debt;
    if accrued > 0 {
        pos.pending += accrued;
    }
}

#[contractimpl]
impl Staking {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PoolCount, &0u32);
    }

    /// Whitelist a stake token with its reward stream. Returns pool id.
    pub fn add_pool(
        env: Env,
        stake_token: Address,
        reward_token: Address,
        reward_rate: i128,
        lock_seconds: u64,
    ) -> u32 {
        admin(&env).require_auth();
        if lock_seconds > MAX_LOCK_SECONDS {
            panic_with_error!(&env, StakingError::LockTooLong);
        }
        let id: u32 = env.storage().instance().get(&DataKey::PoolCount).unwrap();
        let p = Pool {
            stake_token,
            reward_token,
            reward_rate,
            lock_seconds,
            total_staked: 0,
            acc_reward_per_share: 0,
            last_update: env.ledger().timestamp(),
            reward_reserve: 0,
            active: true,
        };
        save_pool(&env, id, &p);
        env.storage().instance().set(&DataKey::PoolCount, &(id + 1));
        id
    }

    pub fn set_reward_rate(env: Env, pool_id: u32, reward_rate: i128) {
        admin(&env).require_auth();
        let mut p = updated(&load_pool(&env, pool_id), env.ledger().timestamp());
        p.reward_rate = reward_rate;
        save_pool(&env, pool_id, &p);
    }

    /// De-whitelist (no new stakes, rewards stop); users can still exit.
    pub fn set_active(env: Env, pool_id: u32, active: bool) {
        admin(&env).require_auth();
        let mut p = updated(&load_pool(&env, pool_id), env.ledger().timestamp());
        p.active = active;
        save_pool(&env, pool_id, &p);
    }

    /// Top up the reward reserve of a pool (anyone may fund).
    pub fn fund(env: Env, from: Address, pool_id: u32, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, StakingError::ZeroAmount);
        }
        let mut p = updated(&load_pool(&env, pool_id), env.ledger().timestamp());
        token::Client::new(&env, &p.reward_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        p.reward_reserve += amount;
        save_pool(&env, pool_id, &p);
    }

    pub fn stake(env: Env, user: Address, pool_id: u32, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, StakingError::ZeroAmount);
        }
        let now = env.ledger().timestamp();
        let mut p = updated(&load_pool(&env, pool_id), now);
        if !p.active {
            panic_with_error!(&env, StakingError::PoolInactive);
        }
        let mut pos = load_pos(&env, pool_id, &user);
        settle(&p, &mut pos);
        token::Client::new(&env, &p.stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );
        pos.amount += amount;
        let unlock = now + p.lock_seconds;
        if unlock > pos.unlock_at {
            pos.unlock_at = unlock;
        }
        pos.reward_debt = pos.amount * p.acc_reward_per_share / ACC;
        p.total_staked += amount;
        save_pool(&env, pool_id, &p);
        save_pos(&env, pool_id, &user, &pos);
        Staked {
            user,
            pool_id,
            amount,
        }
        .publish(&env);
    }

    pub fn unstake(env: Env, user: Address, pool_id: u32, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, StakingError::ZeroAmount);
        }
        let now = env.ledger().timestamp();
        let mut p = updated(&load_pool(&env, pool_id), now);
        let mut pos = load_pos(&env, pool_id, &user);
        if now < pos.unlock_at {
            panic_with_error!(&env, StakingError::Locked);
        }
        if pos.amount < amount {
            panic_with_error!(&env, StakingError::InsufficientStake);
        }
        settle(&p, &mut pos);
        pos.amount -= amount;
        pos.reward_debt = pos.amount * p.acc_reward_per_share / ACC;
        p.total_staked -= amount;
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

    pub fn claim(env: Env, user: Address, pool_id: u32) -> i128 {
        user.require_auth();
        let p = updated(&load_pool(&env, pool_id), env.ledger().timestamp());
        let mut pos = load_pos(&env, pool_id, &user);
        settle(&p, &mut pos);
        let amount = pos.pending;
        pos.pending = 0;
        pos.reward_debt = pos.amount * p.acc_reward_per_share / ACC;
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
        env.storage().instance().get(&DataKey::PoolCount).unwrap_or(0)
    }

    pub fn pool(env: Env, pool_id: u32) -> Pool {
        updated(&load_pool(&env, pool_id), env.ledger().timestamp())
    }

    pub fn position(env: Env, pool_id: u32, user: Address) -> Position {
        load_pos(&env, pool_id, &user)
    }

    pub fn pending_rewards(env: Env, pool_id: u32, user: Address) -> i128 {
        let p = updated(&load_pool(&env, pool_id), env.ledger().timestamp());
        let mut pos = load_pos(&env, pool_id, &user);
        settle(&p, &mut pos);
        pos.pending
    }
}

#[cfg(test)]
mod test;
