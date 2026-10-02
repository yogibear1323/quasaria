//! Tests for the shared timelock: per-class delays, mainnet floors, grace
//! window, guardian cancellation and the timelocked `SetGuardian`, run
//! against a minimal contract that uses the governance macros.
#![cfg(test)]
extern crate std;

use crate::{self as gov, DelayClass, GovError, TimelockAction};
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error,
    testutils::{Address as _, Ledger},
    Address, Bytes, Env, IntoVal, InvokeError, Symbol, Val, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TAction {
    SetGuardian(Address),
    SetDelay(u64),
    /// Stand-in for a critical action (oracle / treasury / upgrade).
    Critical(u32),
    /// Stand-in for a parameter change; must be <= 100.
    Param(u32),
}

impl TimelockAction for TAction {
    fn delay_class(&self) -> DelayClass {
        match self {
            TAction::SetDelay(_) | TAction::Critical(_) => DelayClass::Critical,
            TAction::SetGuardian(_) | TAction::Param(_) => DelayClass::Standard,
        }
    }
    fn validate(&self, env: &Env) {
        if let TAction::Param(p) = self {
            if *p > 100 {
                panic_with_error!(env, GovError::InvalidDelay);
            }
        }
    }
}

#[contracttype]
enum K {
    Param,
}

#[contract]
pub struct TGov;

crate::governance_entrypoints!(TGov, TAction);
crate::pause_entrypoints!(TGov);

#[contractimpl]
impl TGov {
    pub fn __constructor(env: Env, admin: Address, delay: u64) {
        gov::init(&env, &admin, delay);
    }
    pub fn execute_action(env: Env, action: TAction) {
        gov::consume(&env, &action);
        match action {
            TAction::SetGuardian(g) => gov::set_guardian_now(&env, &g),
            TAction::SetDelay(d) => gov::set_delay_now(&env, d),
            TAction::Critical(v) | TAction::Param(v) => env.storage().instance().set(&K::Param, &v),
        }
    }
    pub fn param(env: Env) -> u32 {
        env.storage().instance().get(&K::Param).unwrap_or(0)
    }
}

const H: u64 = 3_600;
const T0: u64 = 1_000_000;

fn mainnet(env: &Env) {
    let h = env
        .crypto()
        .sha256(&Bytes::from_slice(env, gov::MAINNET_PASSPHRASE))
        .to_array();
    env.ledger().set_network_id(h);
}

fn setup(on_mainnet: bool, delay: u64) -> (Env, TGovClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(T0);
    if on_mainnet {
        mainnet(&env);
    }
    let admin = Address::generate(&env);
    let id = env.register(TGov, (&admin, delay));
    (env.clone(), TGovClient::new(&env, &id), admin)
}

fn warp(env: &Env, secs: u64) {
    env.ledger().set_timestamp(env.ledger().timestamp() + secs);
}

fn gerr(e: GovError) -> Result<soroban_sdk::Error, InvokeError> {
    Ok(e.into())
}

/// Asserts the contract exposes no entry point called `name` (the instant
/// setter was removed, so any call is rejected by the host).
pub fn assert_no_entrypoint(env: &Env, contract: &Address, name: &str, args: Vec<Val>) {
    let r = env.try_invoke_contract::<Val, InvokeError>(contract, &Symbol::new(env, name), args);
    assert!(r.is_err(), "instant `{name}` must not exist");
}

#[test]
fn instant_set_guardian_is_gone() {
    let (env, c, _) = setup(false, 300);
    let g = Address::generate(&env);
    // positive control: an existing entry point is reachable the same way
    let ok = env.try_invoke_contract::<Address, InvokeError>(
        &c.address,
        &Symbol::new(&env, "guardian"),
        Vec::new(&env),
    );
    assert!(matches!(ok, Ok(Ok(_))));
    assert_no_entrypoint(&env, &c.address, "set_guardian", (g.clone(),).into_val(&env));
    assert_ne!(c.guardian(), g);
}

#[test]
fn set_guardian_queue_wait_execute() {
    let (env, c, admin) = setup(false, 300);
    assert_eq!(c.guardian(), admin);
    let g = Address::generate(&env);
    let a = TAction::SetGuardian(g.clone());
    assert_eq!(c.propose_action(&a), T0 + 300);
    assert_eq!(c.action_eta(&a), Some(T0 + 300));
    assert_eq!(c.try_execute_action(&a), Err(gerr(GovError::TimelockNotReady)));
    warp(&env, 299);
    assert_eq!(c.try_execute_action(&a), Err(gerr(GovError::TimelockNotReady)));
    warp(&env, 1);
    c.execute_action(&a);
    assert_eq!(c.guardian(), g);
    assert_eq!(c.action_eta(&a), None);
    // the new guardian can pause; the old one (admin) still can as admin
    c.pause(&g);
    assert!(c.paused());
    // replaying the executed action fails
    assert_eq!(c.try_execute_action(&a), Err(gerr(GovError::NotQueued)));
}

#[test]
fn guardian_cancels_malicious_guardian_swap() {
    let (env, c, _) = setup(false, 300);
    let g = Address::generate(&env);
    let a = TAction::SetGuardian(g.clone());
    c.propose_action(&a);
    warp(&env, 300);
    c.execute_action(&a);
    // a (compromised) admin queues a swap to an attacker key
    let evil = Address::generate(&env);
    let swap = TAction::SetGuardian(evil.clone());
    c.propose_action(&swap);
    // a random account cannot cancel
    let rando = Address::generate(&env);
    assert_eq!(c.try_cancel_action(&rando, &swap), Err(gerr(GovError::NotGuardian)));
    // the guardian cancels before the ETA
    c.cancel_action(&g, &swap);
    assert_eq!(c.action_eta(&swap), None);
    warp(&env, 300);
    assert_eq!(c.try_execute_action(&swap), Err(gerr(GovError::NotQueued)));
    assert_eq!(c.guardian(), g);
    // cancelling twice fails
    assert_eq!(c.try_cancel_action(&g, &swap), Err(gerr(GovError::NotQueued)));
}

#[test]
fn testnet_delay_is_configured_value_for_every_class() {
    let (env, c, _) = setup(false, 300);
    assert_eq!(c.action_delay(&TAction::Param(1)), 300);
    assert_eq!(c.action_delay(&TAction::Critical(1)), 300);
    assert_eq!(c.action_delay(&TAction::SetGuardian(Address::generate(&env))), 300);
    assert_eq!(c.propose_action(&TAction::Critical(7)), T0 + 300);
    assert_eq!(gov::MIN_DELAY, 60);
}

#[test]
fn mainnet_rejects_short_base_delay() {
    let env = Env::default();
    env.mock_all_auths();
    mainnet(&env);
    let admin = Address::generate(&env);
    for d in [300u64, 47 * H, 48 * H - 1] {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(TGov, (&admin, d));
        }));
        assert!(r.is_err(), "base delay {d} must be rejected on mainnet");
    }
    env.register(TGov, (&admin, 48 * H));
}

#[test]
fn mainnet_floors_48h_standard_72h_critical() {
    let (env, c, _) = setup(true, 48 * H);
    assert_eq!(c.timelock_delay(), 48 * H);
    assert_eq!(c.action_delay(&TAction::Param(1)), 48 * H);
    assert_eq!(c.action_delay(&TAction::SetGuardian(Address::generate(&env))), 48 * H);
    assert_eq!(c.action_delay(&TAction::Critical(1)), 72 * H);
    assert_eq!(c.action_delay(&TAction::SetDelay(50 * H)), 72 * H);

    let p = TAction::Param(5);
    let crit = TAction::Critical(9);
    assert_eq!(c.propose_action(&p), T0 + 48 * H);
    assert_eq!(c.propose_action(&crit), T0 + 72 * H);
    warp(&env, 48 * H);
    c.execute_action(&p);
    assert_eq!(c.param(), 5);
    // the critical action is NOT ready at 48 h
    assert_eq!(c.try_execute_action(&crit), Err(gerr(GovError::TimelockNotReady)));
    warp(&env, 24 * H - 1);
    assert_eq!(c.try_execute_action(&crit), Err(gerr(GovError::TimelockNotReady)));
    warp(&env, 1);
    c.execute_action(&crit);
    assert_eq!(c.param(), 9);
}

#[test]
fn mainnet_longer_base_delay_applies_to_both_classes() {
    let (env, c, _) = setup(true, 96 * H);
    assert_eq!(c.action_delay(&TAction::Param(1)), 96 * H);
    assert_eq!(c.action_delay(&TAction::Critical(1)), 96 * H);
    let _ = env;
}

#[test]
fn mainnet_set_delay_cannot_go_below_48h() {
    let (env, c, _) = setup(true, 72 * H);
    let bad = TAction::SetDelay(47 * H);
    c.propose_action(&bad);
    warp(&env, 72 * H);
    assert_eq!(c.try_execute_action(&bad), Err(gerr(GovError::InvalidDelay)));
    let ok = TAction::SetDelay(48 * H);
    c.propose_action(&ok);
    warp(&env, 72 * H);
    c.execute_action(&ok);
    assert_eq!(c.timelock_delay(), 48 * H);
    // critical actions still wait 72 h after lowering the base delay
    assert_eq!(c.action_delay(&TAction::Critical(1)), 72 * H);
}

#[test]
fn grace_window_is_14_days() {
    let (env, c, _) = setup(false, 300);
    assert_eq!(gov::GRACE_PERIOD, 14 * 86_400);
    let a = TAction::Param(3);
    let b = TAction::Param(4);
    c.propose_action(&a);
    c.propose_action(&b);
    warp(&env, 300 + 14 * 86_400);
    c.execute_action(&a); // exactly at eta + grace: still valid
    assert_eq!(c.param(), 3);
    warp(&env, 1);
    assert_eq!(c.try_execute_action(&b), Err(gerr(GovError::TimelockExpired)));
    // an expired action can be cancelled and re-queued
    c.cancel_action(&c.admin(), &b);
    c.propose_action(&b);
}

#[test]
fn validate_runs_at_queue_time_and_duplicates_rejected() {
    let (_env, c, _) = setup(false, 300);
    assert_eq!(c.try_propose_action(&TAction::Param(101)), Err(gerr(GovError::InvalidDelay)));
    c.propose_action(&TAction::Param(100));
    assert_eq!(c.try_propose_action(&TAction::Param(100)), Err(gerr(GovError::AlreadyQueued)));
}

#[test]
fn only_admin_can_queue_and_execute() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    let admin = Address::generate(&env);
    let id = env.register(TGov, (&admin, 300u64));
    let c = TGovClient::new(&env, &id);
    // no auths mocked: admin signature missing
    assert!(c.try_propose_action(&TAction::Param(1)).is_err());
    env.mock_all_auths();
    c.propose_action(&TAction::Param(1));
    env.set_auths(&[]);
    warp(&env, 300);
    assert!(c.try_execute_action(&TAction::Param(1)).is_err());
}
