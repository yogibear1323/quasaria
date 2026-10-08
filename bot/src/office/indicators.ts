/** Candle + indicator helpers (pure). All series are oldest -> newest. */
export interface Candle {
  t: number; // bar open time, unix s
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number; // base volume (optional; used by the calibrated desk state engine)
}

export function emaSeries(v: number[], n: number): number[] {
  const out: number[] = [];
  const k = 2 / (n + 1);
  let e = NaN;
  for (let i = 0; i < v.length; i++) {
    if (i === n - 1) e = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) e = v[i] * k + e * (1 - k);
    out.push(i >= n - 1 ? e : NaN);
  }
  return out;
}
export const last = (v: number[]) => v[v.length - 1];

export function sma(v: number[], n: number) {
  if (v.length < n) return NaN;
  return v.slice(-n).reduce((a, b) => a + b, 0) / n;
}
export function stdev(v: number[], n: number) {
  if (v.length < n) return NaN;
  const s = v.slice(-n);
  const m = s.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / n);
}
export function bollinger(v: number[], n = 20, k = 2) {
  const mid = sma(v, n);
  const sd = stdev(v, n);
  return { mid, upper: mid + k * sd, lower: mid - k * sd };
}

const tr = (c: Candle, prev?: Candle) => (prev ? Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c)) : c.h - c.l);

/** Wilder ATR. */
export function atr(bars: Candle[], n = 14) {
  if (bars.length < n + 1) return NaN;
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(bars[i], bars[i - 1]);
  a /= n;
  for (let i = n + 1; i < bars.length; i++) a = (a * (n - 1) + tr(bars[i], bars[i - 1])) / n;
  return a;
}

/** Wilder RSI. */
export function rsi(v: number[], n = 14) {
  if (v.length < n + 1) return NaN;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= n; l /= n;
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}

/** Wilder ADX. */
export function adx(bars: Candle[], n = 14) {
  if (bars.length < 2 * n + 1) return NaN;
  let trS = 0, pS = 0, mS = 0;
  const dx: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const dn = bars[i - 1].l - bars[i].l;
    const p = up > dn && up > 0 ? up : 0;
    const m = dn > up && dn > 0 ? dn : 0;
    const t = tr(bars[i], bars[i - 1]);
    if (i <= n) {
      trS += t; pS += p; mS += m;
      if (i < n) continue;
    } else {
      trS = trS - trS / n + t; pS = pS - pS / n + p; mS = mS - mS / n + m;
    }
    const pdi = trS ? (100 * pS) / trS : 0;
    const mdi = trS ? (100 * mS) / trS : 0;
    dx.push(pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0);
  }
  if (dx.length < n) return NaN;
  let a = dx.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n;
  return a;
}

/** Highest high / lowest low of the `n` bars BEFORE the last bar. */
export function donchianPrev(bars: Candle[], n = 20) {
  if (bars.length < n + 1) return { high: NaN, low: NaN };
  const w = bars.slice(-n - 1, -1);
  return { high: Math.max(...w.map((b) => b.h)), low: Math.min(...w.map((b) => b.l)) };
}

/** Aggregate consecutive bars into bars of `k`× the size (aligned on t % (k*gran) == 0). */
export function aggregate(bars: Candle[], gran: number, k: number): Candle[] {
  const size = gran * k;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let count = 0;
  for (const b of bars) {
    const start = Math.floor(b.t / size) * size;
    if (!cur || cur.t !== start) {
      if (cur && count === k) out.push(cur);
      cur = { t: start, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 };
      count = 1;
    } else {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v = (cur.v ?? 0) + (b.v ?? 0); count++;
    }
  }
  if (cur && count === k) out.push(cur);
  return out;
}
