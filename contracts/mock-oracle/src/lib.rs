//! # Quasaria mock oracle
//!
//! Implements the subset of the **Reflector** (SEP-40 style) price-feed
//! interface that Quasaria uses — `base`, `decimals`, `resolution`,
//! `lastprice`, `price` — with identical `Asset` / `PriceData` XDR shapes, so
//! the leverage vault can point at either this mock (tests / testnet demos)
//! or a real Reflector contract without code changes.
//!
//! **Never deploy to mainnet**: the admin can push any price and timestamp.
//! Governance: two-step admin transfer and timelocked `Upgrade` / `SetDelay`
//! (no user-facing entry points, so no pause). Storage TTLs are extended on
//! every write and read.
#![no_std]

use quasaria_gov as gov;
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Symbol};

soroban_sdk::contractmeta!(key = "project", val = "Quasaria");
soroban_sdk::contractmeta!(key = "desc", val = "Quasaria mock oracle (Reflector-compatible)");
soroban_sdk::contractmeta!(key = "network", val = "testnet-only scaffold, unaudited");

/// Same shape as Reflector's `Asset`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// Same shape as Reflector's `PriceData`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Timelocked admin actions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OracleAction {
    Upgrade(BytesN<32>),
    SetDelay(u64),
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Decimals,
    Price(Asset),
}

#[contract]
pub struct MockOracle;

quasaria_gov::governance_entrypoints!(MockOracle, OracleAction);

#[contractimpl]
impl MockOracle {
    pub fn __constructor(env: Env, admin: Address, decimals: u32, timelock_delay: u64) {
        gov::init(&env, &admin, timelock_delay);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
    }

    pub fn execute_action(env: Env, action: OracleAction) {
        gov::consume(&env, &action);
        match action {
            OracleAction::Upgrade(hash) => gov::upgrade_now(&env, &hash),
            OracleAction::SetDelay(d) => gov::set_delay_now(&env, d),
        }
    }

    /// Admin-only price push. `timestamp = 0` means "now".
    pub fn set_price(env: Env, asset: Asset, price: i128, timestamp: u64) {
        gov::require_admin(&env);
        let ts = if timestamp == 0 {
            env.ledger().timestamp()
        } else {
            timestamp
        };
        let k = DataKey::Price(asset);
        env.storage().persistent().set(
            &k,
            &PriceData {
                price,
                timestamp: ts,
            },
        );
        gov::bump_persistent(&env, &k);
    }

    pub fn base(env: Env) -> Asset {
        Asset::Other(Symbol::new(&env, "USD"))
    }

    pub fn decimals(env: Env) -> u32 {
        gov::bump_instance(&env);
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(14)
    }

    pub fn resolution(_env: Env) -> u32 {
        300
    }

    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        gov::bump_instance(&env);
        let k = DataKey::Price(asset);
        let v = env.storage().persistent().get(&k);
        gov::bump_persistent(&env, &k);
        v
    }

    pub fn price(env: Env, asset: Asset, _timestamp: u64) -> Option<PriceData> {
        Self::lastprice(env, asset)
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use quasaria_gov::GovError;
    use soroban_sdk::{
        testutils::{storage::{Instance as _, Persistent as _}, Address as _, Ledger},
        Env,
    };

    #[test]
    fn stores_and_returns_prices() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(777);
        let admin = Address::generate(&env);
        let id = env.register(MockOracle, (&admin, 14u32, 300u64));
        let c = MockOracleClient::new(&env, &id);
        let xlm = Asset::Other(Symbol::new(&env, "XLM"));
        assert_eq!(c.lastprice(&xlm), None);
        c.set_price(&xlm, &12_000_000_000_000, &0);
        assert_eq!(
            c.lastprice(&xlm),
            Some(PriceData { price: 12_000_000_000_000, timestamp: 777 })
        );
        assert_eq!(c.price(&xlm, &0), c.lastprice(&xlm));
        c.set_price(&xlm, &1, &5_000);
        assert_eq!(c.lastprice(&xlm).unwrap().timestamp, 5_000);
        assert_eq!(c.decimals(), 14);
        assert_eq!(c.resolution(), 300);
        assert_eq!(c.base(), Asset::Other(Symbol::new(&env, "USD")));
    }

    /// Regression F-08: instance and price entries get their TTL extended.
    #[test]
    fn regression_f08_ttl_extended() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(MockOracle, (&admin, 14u32, 300u64));
        let c = MockOracleClient::new(&env, &id);
        let xlm = Asset::Other(Symbol::new(&env, "XLM"));
        c.set_price(&xlm, &1, &0);
        env.as_contract(&id, || {
            assert!(env.storage().instance().get_ttl() >= gov::INSTANCE_BUMP_TO - 1);
            assert!(
                env.storage().persistent().get_ttl(&DataKey::Price(xlm.clone()))
                    >= gov::PERSISTENT_BUMP_TO - 1
            );
        });
    }

    #[test]
    fn two_step_admin_and_timelocked_delay() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let admin = Address::generate(&env);
        let c = MockOracleClient::new(&env, &env.register(MockOracle, (&admin, 14u32, 300u64)));
        let next = Address::generate(&env);
        c.propose_admin(&next);
        assert_eq!(c.admin(), admin);
        c.accept_admin();
        assert_eq!(c.admin(), next);
        let a = OracleAction::SetDelay(600);
        c.propose_action(&a);
        assert_eq!(c.try_execute_action(&a), Err(Ok(GovError::TimelockNotReady.into())));
        env.ledger().set_timestamp(1_300);
        c.execute_action(&a);
        assert_eq!(c.timelock_delay(), 600);
    }

    /// On mainnet the timelock can never be shorter than 48h (enforced on-chain).
    #[test]
    fn mainnet_enforces_48h_minimum_delay() {
        let env = Env::default();
        env.mock_all_auths();
        let h = env
            .crypto()
            .sha256(&soroban_sdk::Bytes::from_slice(&env, gov::MAINNET_PASSPHRASE))
            .to_array();
        env.ledger().set_network_id(h);
        let admin = Address::generate(&env);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(MockOracle, (&admin, 14u32, 300u64));
        }));
        assert!(r.is_err(), "300 s delay rejected on mainnet");
        let c = MockOracleClient::new(&env, &env.register(MockOracle, (&admin, 14u32, 48u64 * 3_600)));
        assert_eq!(c.timelock_delay(), 172_800);
        let shorten = OracleAction::SetDelay(3_600);
        c.propose_action(&shorten);
        env.ledger().set_timestamp(env.ledger().timestamp() + 172_800);
        assert_eq!(c.try_execute_action(&shorten), Err(Ok(GovError::InvalidDelay.into())));
    }

    #[test]
    fn timelock_cancel_expiry_and_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let admin = Address::generate(&env);
        let c = MockOracleClient::new(&env, &env.register(MockOracle, (&admin, 14u32, 300u64)));
        let a = OracleAction::SetDelay(900);
        c.propose_action(&a);
        assert_eq!(c.try_propose_action(&a), Err(Ok(GovError::AlreadyQueued.into())));
        assert_eq!(c.action_eta(&a), Some(1_300));
        c.cancel_action(&admin, &a);
        assert_eq!(c.action_eta(&a), None);
        env.ledger().set_timestamp(1_300);
        assert_eq!(c.try_execute_action(&a), Err(Ok(GovError::NotQueued.into())));
        // expires after the grace period
        c.propose_action(&a);
        env.ledger().set_timestamp(1_600 + gov::GRACE_PERIOD + 1);
        assert_eq!(c.try_execute_action(&a), Err(Ok(GovError::TimelockExpired.into())));
        // out-of-range delay rejected at execution
        let bad = OracleAction::SetDelay(1);
        c.propose_action(&bad);
        env.ledger().set_timestamp(env.ledger().timestamp() + 300);
        assert_eq!(c.try_execute_action(&bad), Err(Ok(GovError::InvalidDelay.into())));
        // only the admin can queue
        env.set_auths(&[]);
        assert!(c.try_propose_action(&OracleAction::SetDelay(600)).is_err());
        assert!(c.try_set_price(&Asset::Other(Symbol::new(&env, "XLM")), &1, &0).is_err());
        // accept without a pending admin fails
        env.mock_all_auths();
        assert_eq!(c.try_accept_admin(), Err(Ok(GovError::NoPendingAdmin.into())));
    }
}
