#![cfg(test)]
use super::*;
use soroban_sdk::Env;

const PCT: i128 = RATE_SCALE / 100;

#[test]
fn skew_premium_direction_and_clamp() {
    let e = Env::default();
    // k = 1.0, scale 1_000: skew +100 -> +10 %, clamped to 5 %
    assert_eq!(skew_premium(&e, 300, 200, RATE_SCALE, 1_000, 50 * PCT), 10 * PCT);
    assert_eq!(skew_premium(&e, 300, 200, RATE_SCALE, 1_000, 5 * PCT), 5 * PCT);
    assert_eq!(skew_premium(&e, 200, 300, RATE_SCALE, 1_000, 5 * PCT), -5 * PCT);
    assert_eq!(skew_premium(&e, 7, 7, RATE_SCALE, 1_000, 5 * PCT), 0);
    assert_eq!(skew_premium(&e, 9, 0, 0, 1_000, 5 * PCT), 0, "k = 0 disables");
    assert_eq!(skew_premium(&e, 9, 0, RATE_SCALE, 0, 5 * PCT), 0, "bad scale disables");
    // floor toward -inf on negatives
    assert_eq!(skew_premium(&e, 0, 1, 1, 3, RATE_SCALE), -1);
}

#[test]
fn mark_and_premium_round_trip() {
    let e = Env::default();
    let p = 100_000_000_000_000i128; // 1.0 @ 14 dp
    let m = mark_price(&e, p, 2 * PCT);
    assert_eq!(m, 102_000_000_000_000);
    assert_eq!(premium_from_mark(&e, m, p), 2 * PCT);
    assert!(mark_price(&e, p, -2 * PCT) < p, "cheap mark below oracle");
}

#[test]
fn rate_cap_scales_with_interval() {
    let e = Env::default();
    let max_h = PCT / 20; // 0.05 %/h
    assert_eq!(funding_rate(&e, PCT, 0, max_h, 3_600), max_h);
    assert_eq!(funding_rate(&e, -PCT, 0, max_h, 3_600), -max_h);
    assert_eq!(funding_rate(&e, PCT, 0, max_h, 7_200), 2 * max_h);
    assert_eq!(funding_rate(&e, PCT / 1_000, PCT / 1_000, max_h, 3_600), PCT / 500, "interest adds");
}

#[test]
fn intervals_and_catchup_cap() {
    assert_eq!(elapsed_intervals(1_000, 1_000, 3_600, 24), (0, 0));
    assert_eq!(elapsed_intervals(4_599, 1_000, 3_600, 24), (0, 0));
    assert_eq!(elapsed_intervals(4_600, 1_000, 3_600, 24), (1, 1));
    assert_eq!(elapsed_intervals(1_000 + 3_600 * 30, 1_000, 3_600, 24), (30, 24));
    assert_eq!(elapsed_intervals(10, 20, 3_600, 24), (0, 0), "clock behind");
}

#[test]
fn twap_floors_and_falls_back() {
    let e = Env::default();
    assert_eq!(twap(&e, 0, 0, 77), 77);
    assert_eq!(twap(&e, 10, 4, 0), 2);
    assert_eq!(twap(&e, -10, 4, 0), -3);
}

#[test]
fn owed_rounds_in_the_vaults_favour() {
    let e = Env::default();
    // index moved by 1/3 unit per 1.0 notional -> size 10 owes 3.33..
    let d = RATE_SCALE / 3;
    let long = funding_owed(&e, true, 10, 0, d);
    let short = funding_owed(&e, false, 10, 0, d);
    assert_eq!(long, 4, "payer rounded up");
    assert_eq!(short, -3, "receiver rounded down");
    assert!(long + short >= 0, "net to vault never negative on a balanced book");
    // exhaustive small sweep: payer + receiver of equal size never net < 0
    for size in 1..60i128 {
        for delta in [-RATE_SCALE / 7, -1, 1, RATE_SCALE / 9, RATE_SCALE / 3 + 1] {
            let a = funding_owed(&e, true, size, 0, delta);
            let b = funding_owed(&e, false, size, 0, delta);
            assert!(a + b >= 0, "size {size} delta {delta}: {a} + {b}");
        }
    }
}
