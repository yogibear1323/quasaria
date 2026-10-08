/**
 * Trade geometry, paper fills and outcome resolution for the calibrated desk (pure). Mirrors research/quant/common.py:
 * stop = clamp(slAtr x ATR, 0.8 %, 7.5 %), target = stop x tp/sl; stop checked first; gaps fill at the open;
 * 5 bps slippage on every fill; 10 bps open fee on notional; funding while open; time exit after T bars at the close.
 */
import type { Candle } from "../indicators.js";
import type { Question } from "./model.js";

export const OPEN_FEE = 0.001, SLIP = 0.0005, MIN_STOP = 0.008, MAX_STOP = 0.075, FEE_BUFFER = 0.0025;
const DEFAULT_FUNDING_HOURLY = 0.00001; // adverse 0.001 %/h when no live funding estimate is available

export interface Geometry { tpAtr: number; slAtr: number }
export const stopDist = (atr: number, price: number, g: Geometry) => Math.min(MAX_STOP, Math.max(MIN_STOP, (g.slAtr * atr) / price));

export interface PaperTrade {
  side: "long" | "short";
  ref: number; // decision close
  entry: number; // fill incl. slippage
  stop: number;
  takeProfit: number;
  stopDist: number;
  openedBarT: number;
  expiresBarT: number; // last bar (open time) of the holding window
  notional: number;
  riskAmount: number;
  fundingHourly: number;
}

export function openPaper(side: "long" | "short", ref: number, atr: number, g: Geometry, barT: number, gran: number, T: number, notional: number, riskAmount: number, fundingHourly: number | null): PaperTrade {
  const sg = side === "long" ? 1 : -1;
  const d = stopDist(atr, ref, g);
  return {
    side, ref, entry: ref * (1 + sg * SLIP), stop: ref * (1 - sg * d), takeProfit: ref * (1 + (sg * d * g.tpAtr) / g.slAtr), stopDist: d,
    openedBarT: barT, expiresBarT: barT + T * gran, notional, riskAmount, fundingHourly: fundingHourly ?? sg * DEFAULT_FUNDING_HOURLY,
  };
}

/** Walk closed bars after the entry bar; returns the exit (or null while still open). */
export function stepPaper(p: PaperTrade, bars: Candle[], gran: number): { exitBarT: number; exit: number; reason: "stop_loss" | "take_profit" | "time"; ret: number; pnl: number } | null {
  const sg = p.side === "long" ? 1 : -1;
  for (const b of bars) {
    if (b.t <= p.openedBarT) continue;
    let px: number | null = null, reason: "stop_loss" | "take_profit" | "time" = "time";
    if (sg === 1) {
      if (b.l <= p.stop) (px = Math.min(p.stop, b.o) * (1 - SLIP)), (reason = "stop_loss");
      else if (b.h >= p.takeProfit) (px = Math.max(p.takeProfit, b.o) * (1 - SLIP)), (reason = "take_profit");
    } else {
      if (b.h >= p.stop) (px = Math.max(p.stop, b.o) * (1 + SLIP)), (reason = "stop_loss");
      else if (b.l <= p.takeProfit) (px = Math.min(p.takeProfit, b.o) * (1 + SLIP)), (reason = "take_profit");
    }
    if (px === null && b.t >= p.expiresBarT) px = b.c * (1 - sg * SLIP);
    if (px !== null) {
      const hours = ((b.t + gran - (p.openedBarT + gran)) / 3600);
      const ret = sg * (px / p.entry - 1) - OPEN_FEE - sg * p.fundingHourly * hours;
      return { exitBarT: b.t, exit: px, reason, ret, pnl: ret * p.notional };
    }
  }
  return null;
}

/** Mark-to-market of an open paper trade at a price (fee already paid). */
export const markPaper = (p: PaperTrade, price: number) => p.notional * ((p.side === "long" ? 1 : -1) * (price / p.entry - 1) - OPEN_FEE);

/**
 * Resolve every fixed-outcome question for a decision made at the close of bar `barT`, once T bars have closed.
 * Returns null until the horizon is complete. Same definitions as research/quant/common.py question_labels().
 */
export function resolveQuestions(barsAll: Candle[], barT: number, gran: number, T: number, atr: number, rv96: number, g: Geometry): Record<Question, number> | null {
  const i = barsAll.findIndex((b) => b.t === barT);
  if (i < 0 || i + T >= barsAll.length) return null;
  const fwd = barsAll.slice(i + 1, i + T + 1);
  if (fwd.length < T || fwd[T - 1].t !== barT + T * gran) return null;
  const c0 = barsAll[i].c, cT = fwd[T - 1].c;
  let path = Math.abs(fwd[0].c - c0);
  for (let k = 1; k < T; k++) path += Math.abs(fwd[k].c - fwd[k - 1].c);
  const half = Math.max(1, Math.floor(T / 2));
  let bp = 0;
  for (let k = 0; k < half; k++) {
    const b = fwd[k];
    bp += (b.h > b.l ? (b.c - b.l - (b.h - b.c)) / (b.h - b.l) : 0) * (b.v ?? 0);
  }
  const lr = fwd.map((b, k) => Math.log(b.c / (k ? fwd[k - 1].c : c0)));
  const m = lr.reduce((a, x) => a + x, 0) / T;
  const sd = Math.sqrt(lr.reduce((a, x) => a + (x - m) ** 2, 0) / T);
  const setup = (side: "long" | "short") => {
    const p = openPaper(side, c0, atr, g, barT, gran, T, 1, 0, null);
    const r = stepPaper(p, fwd, gran);
    return r && r.ret > 0 ? 1 : 0;
  };
  return {
    direction: cT > c0 ? 1 : 0,
    regime: path > 0 && Math.abs(cT - c0) / path >= 0.3 ? 1 : 0,
    pressure: bp > 0 ? 1 : 0,
    risk: sd <= 1.25 * rv96 ? 1 : 0,
    setup_long: setup("long"),
    setup_short: setup("short"),
  };
}
