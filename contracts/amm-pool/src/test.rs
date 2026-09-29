#![cfg(test)]
extern crate std;

use super::*;
use quasaria_referral::{ReferralRegistry, ReferralRegistryClient};
use quasaria_gov::GovError;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Event,
};

const DELAY: u64 = 600;

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
    let reg_id = env.register(ReferralRegistry, (&admin, 2_000u32, DELAY)); // 20% of fee
    let pool_id = env.register(
        AmmPool,
        (&admin, &ta, &tb, 30u32, Some(reg_id.clone()), DELAY),
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
    let a = PoolAction::SetFeeBps(101);
    t.pool.propose_action(&a);
    advance(&t.env, DELAY);
    assert_eq!(t.pool.try_execute_action(&a), Err(Ok(PoolError::FeeTooHigh.into())));
    assert_eq!(t.pool.try_swap(&u, &u, &t.a.address, &0, &0), Err(Ok(PoolError::ZeroAmount.into())));
}

#[test]
fn sqrt_works() {
    assert_eq!(sqrt(0), 0);
    assert_eq!(sqrt(1), 1);
    assert_eq!(sqrt(15), 3);
    assert_eq!(sqrt(16), 4);
    assert_eq!(sqrt(1_000_000_000_000_000_000), 1_000_000_000);
}

fn advance(env: &Env, secs: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + secs);
}

fn seeded(t: &T) -> (Address, Address) {
    let lp = Address::generate(&t.env);
    let trader = Address::generate(&t.env);
    fund(t, &lp, 10_000_000_000);
    fund(t, &trader, 10_000_000_000);
    t.pool.deposit(&lp, &1_000_000_000, &1_000_000_000, &0, &0);
    (lp, trader)
}

// ------------------------------------------------------------------ F-05

/// A hostile "referral registry": everyone is referred by `attacker` and the
/// share is absurd. Before the fix the pool paid `fee * share / 10_000`
/// straight out of its reserves.
#[contract]
pub struct EvilRegistry;

#[contractimpl]
impl EvilRegistry {
    pub fn __constructor(env: Env, attacker: Address) {
        env.storage().instance().set(&0u32, &attacker);
    }
    pub fn get_referrer(env: Env, _user: Address) -> Option<Address> {
        env.storage().instance().get(&0u32)
    }
    pub fn share_bps(_env: Env) -> u32 {
        u32::MAX
    }
    pub fn record_reward(_env: Env, _s: Address, _r: Address, _t: Address, _a: i128) {}
}

/// A registry that always traps.
#[contract]
pub struct BrokenRegistry;

#[contractimpl]
impl BrokenRegistry {
    pub fn get_referrer(_env: Env, _user: Address) -> Option<Address> {
        panic!("broken")
    }
    pub fn share_bps(_env: Env) -> u32 {
        panic!("broken")
    }
}

/// Regression F-05: pointing a pool at a malicious referral contract can move
/// at most 50% of the current swap's fee, never reserves; and the switch
/// itself is timelocked.
#[test]
fn regression_f05_malicious_referral_cannot_drain_pool() {
    let t = setup();
    let (_lp, trader) = seeded(&t);
    let attacker = Address::generate(&t.env);
    let evil = t.env.register(EvilRegistry, (&attacker,));
    let act = PoolAction::SetReferral(Some(evil.clone()));
    t.pool.propose_action(&act);
    // cannot be switched instantly
    assert_eq!(t.pool.try_execute_action(&act), Err(Ok(GovError::TimelockNotReady.into())));
    advance(&t.env, DELAY);
    t.pool.execute_action(&act);
    assert_eq!(t.pool.referral(), Some(evil));
    let (ra0, rb0) = t.pool.reserves();
    let amount_in = 1_000_000i128;
    t.pool.swap(&trader, &trader, &t.a.address, &amount_in, &0);
    let fee = fee_for(&t.env, amount_in, 30);
    let stolen = t.a.balance(&attacker);
    std::println!(
        "F-05 regression: evil registry share=u32::MAX, fee={fee}, attacker got {stolen} (cap 50% of fee); reserves {ra0}/{rb0} -> {:?}",
        t.pool.reserves()
    );
    assert_eq!(stolen, fee * i128::from(MAX_REFERRAL_SHARE_BPS) / 10_000);
    let (ra, _rb) = t.pool.reserves();
    assert_eq!(ra, ra0 + amount_in - stolen, "reserve_in only grows");
    assert_eq!(t.a.balance(&t.pool.address), ra, "reserves stay fully backed");
    assert_eq!(t.b.balance(&t.pool.address), t.pool.reserves().1);
    assert!(t.b.balance(&attacker) == 0);
}

#[test]
fn broken_registry_cannot_brick_swaps() {
    let t = setup();
    let (_lp, trader) = seeded(&t);
    let broken = t.env.register(BrokenRegistry, ());
    let act = PoolAction::SetReferral(Some(broken));
    t.pool.propose_action(&act);
    advance(&t.env, DELAY);
    t.pool.execute_action(&act);
    let out = t.pool.swap(&trader, &trader, &t.a.address, &1_000_000, &0);
    assert!(out > 0);
    // removing the hook also goes through the timelock
    let none = PoolAction::SetReferral(None);
    t.pool.propose_action(&none);
    advance(&t.env, DELAY);
    t.pool.execute_action(&none);
    assert_eq!(t.pool.referral(), None);
    assert!(t.pool.swap(&trader, &trader, &t.b.address, &1_000_000, &0) > 0);
}

// ------------------------------------------------------------------ governance

#[test]
fn pause_blocks_trading_but_lps_can_exit() {
    let t = setup();
    let (lp, trader) = seeded(&t);
    let guardian = Address::generate(&t.env);
    t.pool.set_guardian(&guardian);
    t.pool.pause(&guardian);
    assert!(t.pool.paused());
    assert_eq!(
        t.pool.try_swap(&trader, &trader, &t.a.address, &1_000, &0),
        Err(Ok(GovError::Paused.into()))
    );
    assert_eq!(
        t.pool.try_swap_prepaid(&trader, &trader, &t.a.address, &0),
        Err(Ok(GovError::Paused.into()))
    );
    assert_eq!(
        t.pool.try_deposit(&trader, &1_000_000, &1_000_000, &0, &0),
        Err(Ok(GovError::Paused.into()))
    );
    let other = Address::generate(&t.env);
    let s = t.pool.balance(&lp);
    t.pool.transfer(&lp, &other, &(s / 2));
    let (a, b) = t.pool.withdraw(&lp, &(s / 2), &0, &0);
    assert!(a > 0 && b > 0);
    t.pool.unpause();
    t.pool.swap(&trader, &trader, &t.a.address, &1_000, &0);
}

#[test]
fn fee_change_is_timelocked_and_two_step_admin() {
    let t = setup();
    let (_lp, _trader) = seeded(&t);
    let act = PoolAction::SetFeeBps(50);
    assert_eq!(t.pool.propose_action(&act), t.env.ledger().timestamp() + DELAY);
    assert_eq!(t.pool.action_eta(&act), Some(t.env.ledger().timestamp() + DELAY));
    advance(&t.env, DELAY - 1);
    assert_eq!(t.pool.try_execute_action(&act), Err(Ok(GovError::TimelockNotReady.into())));
    advance(&t.env, 1);
    t.pool.execute_action(&act);
    assert_eq!(t.pool.info().fee_bps, 50);
    // replay rejected
    assert_eq!(t.pool.try_execute_action(&act), Err(Ok(GovError::NotQueued.into())));
    let ms = Address::generate(&t.env);
    t.pool.propose_admin(&ms);
    assert_eq!(t.pool.pending_admin(), Some(ms.clone()));
    t.pool.accept_admin();
    assert_eq!(t.pool.admin(), ms);
}

// ------------------------------------------------------------------ F-21

#[test]
fn f21_lp_token_emits_standard_events() {
    let t = setup();
    let lp = Address::generate(&t.env);
    let spender = Address::generate(&t.env);
    fund(&t, &lp, 1_000_000_000);
    let (_, _, s) = t.pool.deposit(&lp, &100_000_000, &100_000_000, &0, &0);
    let live = t.env.ledger().sequence() + 100;
    t.pool.approve(&lp, &spender, &1_000, &live);
    assert_eq!(
        t.env.events().all(),
        std::vec![Approve {
            from: lp.clone(),
            spender: spender.clone(),
            amount: 1_000,
            live_until_ledger: live,
        }
        .to_xdr(&t.env, &t.pool.address)]
    );
    assert_eq!(t.pool.allowance(&lp, &spender), 1_000);
    t.pool.burn_from(&spender, &lp, &400);
    assert_eq!(
        t.env.events().all(),
        std::vec![Burn { from: lp.clone(), amount: 400 }.to_xdr(&t.env, &t.pool.address)]
    );
    assert_eq!(t.pool.allowance(&lp, &spender), 600);
    t.pool.burn(&lp, &100);
    assert_eq!(
        t.env.events().all(),
        std::vec![Burn { from: lp.clone(), amount: 100 }.to_xdr(&t.env, &t.pool.address)]
    );
    t.pool.transfer_from(&spender, &lp, &spender, &600);
    assert_eq!(t.pool.balance(&spender), 600);
    assert_eq!(t.pool.balance(&lp), s - 1_100);
    assert_eq!(
        t.pool.try_transfer_from(&spender, &lp, &spender, &1),
        Err(Ok(PoolError::InsufficientAllowance.into()))
    );
    assert_eq!(
        t.pool.try_approve(&lp, &spender, &-1, &live),
        Err(Ok(PoolError::NegativeAmount.into()))
    );
    t.env.ledger().set_sequence_number(1_000);
    assert_eq!(
        t.pool.try_approve(&lp, &spender, &1, &999),
        Err(Ok(PoolError::InvalidExpiration.into()))
    );
    assert_eq!(t.pool.decimals(), 7);
    assert_eq!(t.pool.name(), soroban_sdk::String::from_str(&t.env, "Quasaria LP"));
}

#[test]
fn deposit_and_withdraw_emit_mint_and_burn() {
    let t = setup();
    let lp = Address::generate(&t.env);
    fund(&t, &lp, 1_000_000_000);
    let (_, _, s) = t.pool.deposit(&lp, &100_000_000, &100_000_000, &0, &0);
    let evs = t.env.events().all().events().to_vec();
    assert!(evs.contains(&Mint { to: t.pool.address.clone(), amount: MINIMUM_LIQUIDITY }.to_xdr(&t.env, &t.pool.address)));
    assert!(evs.contains(&Mint { to: lp.clone(), amount: s }.to_xdr(&t.env, &t.pool.address)));
    t.pool.withdraw(&lp, &s, &0, &0);
    assert!(t.env.events().all().events().contains(&Burn { from: lp.clone(), amount: s }.to_xdr(&t.env, &t.pool.address)));
}

#[test]
fn sync_absorbs_donations() {
    let t = setup();
    let (_lp, trader) = seeded(&t);
    t.a.transfer(&trader, &t.pool.address, &5_000);
    t.pool.sync();
    assert_eq!(t.pool.reserves().0, 1_000_000_000 + 5_000);
}

#[test]
fn huge_amounts_use_wide_math() {
    let env = Env::default();
    // 256-bit mul-div path: no overflow on large reserves
    let big = 10i128.pow(30);
    let out = amount_out(&env, big, big, big, 30);
    assert!(out > 0 && out < big);
}

/// Regression F-08: pool instance + LP balance TTLs are extended.
#[test]
fn regression_f08_ttl_extended() {
    use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
    let t = setup();
    let (lp, _trader) = seeded(&t);
    let seq = t.env.ledger().sequence();
    t.env.ledger().set_sequence_number(seq + quasaria_gov::PERSISTENT_BUMP_TO - quasaria_gov::PERSISTENT_BUMP_THRESHOLD + 10);
    t.pool.balance(&lp);
    t.pool.reserves();
    t.env.as_contract(&t.pool.address, || {
        assert!(t.env.storage().persistent().get_ttl(&DataKey::Lp(lp.clone())) >= quasaria_gov::PERSISTENT_BUMP_TO - 1);
        assert!(t.env.storage().instance().get_ttl() >= quasaria_gov::INSTANCE_BUMP_TO - 1);
    });
}
