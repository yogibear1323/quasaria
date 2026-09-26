//! # Quasaria mock oracle
//!
//! Implements the subset of the **Reflector** (SEP-40 style) price-feed
//! interface that Quasaria uses — `base`, `decimals`, `resolution`,
//! `lastprice`, `price` — with identical `Asset` / `PriceData` XDR shapes, so
//! the leverage vault can point at either this mock (tests / testnet demos)
//! or a real Reflector contract without code changes.
#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

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

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Decimals,
    Price(Asset),
}

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn __constructor(env: Env, admin: Address, decimals: u32) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
    }

    /// Admin-only price push. `timestamp = 0` means "now".
    pub fn set_price(env: Env, asset: Asset, price: i128, timestamp: u64) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let ts = if timestamp == 0 {
            env.ledger().timestamp()
        } else {
            timestamp
        };
        env.storage().persistent().set(
            &DataKey::Price(asset),
            &PriceData {
                price,
                timestamp: ts,
            },
        );
    }

    pub fn base(env: Env) -> Asset {
        Asset::Other(Symbol::new(&env, "USD"))
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(14)
    }

    pub fn resolution(_env: Env) -> u32 {
        300
    }

    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        env.storage().persistent().get(&DataKey::Price(asset))
    }

    pub fn price(env: Env, asset: Asset, _timestamp: u64) -> Option<PriceData> {
        Self::lastprice(env, asset)
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, Env};

    #[test]
    fn stores_and_returns_prices() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(777);
        let admin = Address::generate(&env);
        let c = MockOracleClient::new(&env, &env.register(MockOracle, (&admin, 14u32)));
        let xlm = Asset::Other(Symbol::new(&env, "XLM"));
        assert_eq!(c.lastprice(&xlm), None);
        c.set_price(&xlm, &12_000_000_000_000, &0);
        assert_eq!(
            c.lastprice(&xlm),
            Some(PriceData { price: 12_000_000_000_000, timestamp: 777 })
        );
        assert_eq!(c.decimals(), 14);
        assert_eq!(c.base(), Asset::Other(Symbol::new(&env, "USD")));
    }
}
