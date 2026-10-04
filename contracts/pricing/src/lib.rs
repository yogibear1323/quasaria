//! # Quasaria pricing library (shared, not a contract)
//!
//! Pure fixed-point functions for perps funding. No storage, no auth: every
//! function takes its inputs explicitly so it can be unit/property tested and
//! reused by a future order-book or vAMM engine (which would supply its own
//! mark price and call [`premium_from_mark`] instead of [`skew_premium`]).
//!
//! ## Fixed point
//! * **Rates / premiums / funding index** use [`RATE_SCALE`] = 1e12
//!   (`1_000_000_000_000` = 100 %, `1e8` = 0.01 %). Signed `i128`.
//! * **Prices** are the oracle's integers (14 decimals for Reflector / the
//!   Quasaria mock); this library never assumes the decimals, it only
//!   multiplies prices by `(1 + premium)`.
//! * **Notional / OI / skew** are collateral-token units (7 decimals).
//!
//! ## Rounding (who gains from the last unit)
//! * `skew_premium`, `premium_from_mark`, `twap`, `funding_rate`, index
//!   deltas: **floor (Euclidean, toward −∞)**. The index is shared by both
//!   sides, so its rounding moves value *between traders symmetrically* and can
//!   never mint value by itself.
//! * [`funding_owed`] (the only function that turns the index into tokens):
//!   **ceil (toward +∞)**. A payer (positive result) pays the amount rounded
//!   **up**, a receiver (negative result) receives the magnitude rounded
//!   **down**. Every settlement therefore leaves the rounding remainder with
//!   the vault: funding can never create value.
#![no_std]

use quasaria_gov as gov;
use soroban_sdk::Env;

/// 1.0 for rates, premiums and the cumulative funding index.
pub const RATE_SCALE: i128 = 1_000_000_000_000;
/// Seconds per hour: `max_funding_rate_per_hour` is scaled to the interval.
pub const HOUR: u64 = 3_600;

fn clamp(v: i128, bound: i128) -> i128 {
    let b = if bound < 0 { 0 } else { bound };
    if v > b {
        b
    } else if v < -b {
        -b
    } else {
        v
    }
}

/// `skew_premium = clamp(k * (long_oi - short_oi) / skew_scale, ±max_premium)`
/// (RATE_SCALE units; `k` is RATE_SCALE-scaled, 1e12 = 1.0). Positive when
/// longs dominate (the perp trades "rich"). Floor. `skew_scale <= 0` → 0.
pub fn skew_premium(
    env: &Env,
    long_oi: i128,
    short_oi: i128,
    k: i128,
    skew_scale: i128,
    max_premium: i128,
) -> i128 {
    if skew_scale <= 0 || k == 0 {
        return 0;
    }
    let skew = gov::sub(env, long_oi, short_oi);
    // k * skew / skew_scale (k is already RATE_SCALE-scaled -> result is too)
    clamp(gov::mul_div_floor(env, k, skew, skew_scale), max_premium)
}

/// Mark price implied by a premium: `oracle * (1 + premium)`. Floor.
pub fn mark_price(env: &Env, oracle_price: i128, premium: i128) -> i128 {
    gov::mul_div_floor(env, oracle_price, gov::add(env, RATE_SCALE, premium), RATE_SCALE)
}

/// Premium of an externally supplied mark (order book / vAMM) over the
/// oracle index: `(mark - oracle) / oracle`. Floor. Oracle must be > 0.
pub fn premium_from_mark(env: &Env, mark: i128, oracle_price: i128) -> i128 {
    gov::mul_div_floor(env, gov::sub(env, mark, oracle_price), RATE_SCALE, oracle_price)
}

/// Time-weighted average from an accumulator of `premium * seconds`.
/// `elapsed == 0` → `fallback` (the current premium). Floor.
pub fn twap(env: &Env, acc: i128, elapsed: u64, fallback: i128) -> i128 {
    if elapsed == 0 {
        return fallback;
    }
    gov::mul_div_floor(env, acc, 1, i128::from(elapsed))
}

/// Max funding rate for one interval: `max_per_hour * interval / 3600`. Floor.
pub fn max_rate_per_interval(env: &Env, max_per_hour: i128, interval: u64) -> i128 {
    gov::mul_div_floor(env, max_per_hour, i128::from(interval), i128::from(HOUR))
}

/// `funding_rate_per_interval = clamp(premium_twap + interest, ±cap)`
/// where `cap = max_funding_rate_per_hour * interval / 3600`.
/// Positive → longs pay shorts; negative → shorts pay longs.
pub fn funding_rate(
    env: &Env,
    premium_twap: i128,
    interest: i128,
    max_per_hour: i128,
    interval: u64,
) -> i128 {
    let cap = max_rate_per_interval(env, max_per_hour, interval);
    clamp(gov::add(env, premium_twap, interest), cap)
}

/// Whole intervals elapsed since `last` (0 within an interval or if the
/// clock is behind), and how many of them are charged (`≤ max_catchup`).
pub fn elapsed_intervals(now: u64, last: u64, interval: u64, max_catchup: u32) -> (u64, u64) {
    if interval == 0 || now <= last {
        return (0, 0);
    }
    let n = (now - last) / interval;
    let charged = if n > u64::from(max_catchup) { u64::from(max_catchup) } else { n };
    (n, charged)
}

/// Index advance for `charged` intervals at `rate` (exact product).
pub fn index_delta(env: &Env, rate: i128, charged: u64) -> i128 {
    gov::mul(env, rate, i128::from(charged))
}

/// Signed funding a position owes since it last settled.
/// `> 0` the trader pays (rounded **up**), `< 0` the trader receives
/// (magnitude rounded **down**). Longs owe `size * (index - entry)`, shorts
/// the negation.
pub fn funding_owed(env: &Env, is_long: bool, size: i128, entry_index: i128, current_index: i128) -> i128 {
    let d = if is_long {
        gov::sub(env, current_index, entry_index)
    } else {
        gov::sub(env, entry_index, current_index)
    };
    gov::mul_div_ceil(env, size, d, RATE_SCALE)
}

#[cfg(test)]
mod test;
