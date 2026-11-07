import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { IS_MAINNET, NETWORK, OFFLINE_DEMO } from "../../lib/config";
import { useLiveXlmUsd } from "../../lib/liveMarkets";
import { FEE_BPS, feeEnabled } from "../../lib/fees";
import { fmtAmt, fmtUsd, pctStr, AmountField, CalcDisclaimer, CalcHead, CalcStat } from "./common";
import { quoteNativeLp, type NativeLpQuote } from "../../lib/lpQuote";
import { fetchTradeWindow } from "../../lib/lpQuoteData";
import { isRewardAsset, REWARD_ASSET_CODE, REWARD_ISSUER, REWARD_RATE_TEXT } from "../../lib/rewards";
import {
  NETS, curatedPairs, fetchPoolById, fetchPoolForPair, keyOf, sameAsset, volumeUnit,
  type AssetRef, type NetId, type PoolRow, type Pricing,
} from "../../lib/nativePools";

const IL_PRESETS = [
  { pct: -50, label: "½×" },
  { pct: 0, label: "0" },
  { pct: 100, label: "2×" },
] as const;

export type LpCalcProps = {
  variant?: "full" | "compact";
  net?: NetId;
  pricing?: Pricing;
  /** Wait until the block is near the viewport before reading Horizon. */
  defer?: boolean;
  onOpenPool?: (poolId: string) => void;
};

type Load = { phase: "idle" | "loading" | "missing" | "error" | "ready"; pool: PoolRow | null; walk: Awaited<ReturnType<typeof fetchTradeWindow>> | null };

const idleLoad = (): Load => ({ phase: "idle", pool: null, walk: null });

function pairLabel(a: AssetRef, b: AssetRef) {
  return `${a.code} / ${b.code}`;
}

/** Prefer the GLACIERQ / XLM pair when that issuer exists. No pool list is fetched to decide this. */
function defaultPairIndex(net: NetId, pairs: [AssetRef, AssetRef][]) {
  const iss = REWARD_ISSUER[net];
  const i = pairs.findIndex(([a, b]) => {
    const hasXlm = !a.issuer || !b.issuer;
    const hasReward = !!iss && ((a.code === REWARD_ASSET_CODE && a.issuer === iss) || (b.code === REWARD_ASSET_CODE && b.issuer === iss));
    return hasXlm && hasReward;
  });
  return i >= 0 ? i : 0;
}

export function LpQuoteBody({
  variant, loading, loadError, quote, reserves, controls, glacierMoved, onOpenPool, canOpen,
}: {
  variant: "full" | "compact";
  loading: boolean;
  loadError: string | null;
  quote: NativeLpQuote | null;
  reserves: { reserveA: number; reserveB: number; feeBp: number; codeA: string; codeB: string; id: string } | null;
  controls: ReactNode;
  glacierMoved: { code: string; amount: number } | null;
  onOpenPool?: () => void;
  canOpen: boolean;
}) {
  const feeOn = feeEnabled();
  const showFees = quote?.fees != null;
  return (
    <div className={`card glow calc ${variant === "compact" ? "compact" : ""}`} data-testid="calc-lp">
      <CalcHead icon="🌌" kicker="Calculator · Liquidity" title="Pool fees & impermanent loss" right={variant === "full" ? <Link className="pill cyan" to="/pools">Open Pools</Link> : <Link className="pill cyan" to="/calculators?c=lp">Full calculator</Link>} />
      <p className="muted" style={{ marginTop: 0 }}>Native Stellar pools charge <b>0.30%</b> on each swap. That fee stays in the pool for liquidity providers. The figures below use one live pool and a finished 24 hour list of that pool's own trades.</p>
      {controls}
      {loading && <p className="calc-loading" role="status" data-testid="lp-loading">Reading this pool from Horizon…</p>}
      {loadError && <div className="notice" role="note" data-testid="lp-withheld"><b>Fee estimate withheld.</b> {loadError}</div>}
      {!loading && !loadError && quote && (
        <>
          <p className="calc-window" role="status" data-testid="lp-status">
            <b>{quote.window === "complete" ? "Complete 24h window" : quote.window === "truncated" ? "Incomplete 24h window" : quote.window === "stale" ? "Stale read" : quote.window === "none" ? "No window" : "Window unavailable"}</b>
            {quote.asOfIso && <> · read {quote.asOfIso}</>}
            {quote.windowStartIso && quote.windowEndIso && <> · {quote.windowStartIso} to {quote.windowEndIso}</>}
            {quote.window === "complete" && quote.trades != null && <> · {quote.trades} pool {quote.trades === 1 ? "swap" : "swaps"}</>}
            {quote.window === "truncated" && quote.pages != null && <> · stopped after {quote.pages} pages</>}
          </p>
          {reserves && (
            <p className="muted l-tiny" data-testid="lp-reserves">Reserves {fmtAmt(reserves.reserveA)} {reserves.codeA} and {fmtAmt(reserves.reserveB)} {reserves.codeB}. On-chain fee {(reserves.feeBp / 100).toFixed(2)}%. Pool {reserves.id.slice(0, 8)}…</p>
          )}
          {quote.inputProblem && <p className="calc-hint" data-testid="lp-input">{quote.inputProblem}</p>}
          {quote.share != null && quote.amountA != null && quote.amountB != null && (
            <div className="calc-results" style={{ marginTop: 10 }}>
              <CalcStat label={`Deposit of ${quote.codeA}`} testId="lp-side-a">{fmtAmt(quote.amountA)} <span className="unit">{quote.codeA}</span></CalcStat>
              <CalcStat label={`Deposit of ${quote.codeB}`} testId="lp-side-b">{fmtAmt(quote.amountB)} <span className="unit">{quote.codeB}</span></CalcStat>
              <CalcStat label="Total at the pool ratio" testId="lp-total">
                {quote.depositValue ? <>{fmtAmt(quote.depositValue.amount)} <span className="unit">{quote.depositValue.code}</span>{quote.depositValue.usd != null ? <span className="calc-usd">{fmtUsd(quote.depositValue.usd)}</span> : <span className="calc-usd">USD unavailable</span>}</> : <span className="calc-usd">USD unavailable</span>}
              </CalcStat>
              <CalcStat label="Your share after this deposit" testId="lp-share">{pctStr(quote.share, 3)}<span className="calc-usd">Share = your deposit ÷ (reserves + your deposit)</span></CalcStat>
            </div>
          )}
          {showFees && quote.fees ? (
            <div className="calc-results" style={{ marginTop: 10 }}>
              <CalcStat label="Est. pool fees / day" tone="pos" testId="lp-daily">{fmtAmt(quote.fees.daily)} <span className="unit">{quote.fees.code}</span>{quote.fees.usdPerUnit != null ? <span className="calc-usd">{fmtUsd(quote.fees.daily * quote.fees.usdPerUnit)}</span> : <span className="calc-usd">USD unavailable</span>}</CalcStat>
              <CalcStat label="Est. pool fees / 30 days" testId="lp-monthly">{fmtAmt(quote.fees.monthly)} <span className="unit">{quote.fees.code}</span></CalcStat>
              <CalcStat label="Est. pool fees / 365 days" testId="lp-yearly">{fmtAmt(quote.fees.yearly)} <span className="unit">{quote.fees.code}</span></CalcStat>
              <CalcStat label="Simple annualized fee rate" tone="cyan" testId="lp-apr">{pctStr(quote.fees.apr, 2)}<span className="calc-usd">{quote.fees.zeroVolume ? "Complete window, no measured volume. Not a forecast." : "If this volume and your share stayed constant. Not a forecast or a guaranteed reward."}</span></CalcStat>
            </div>
          ) : quote.windowProblem ? (
            <div className="notice" role="note" data-testid="lp-withheld"><b>Fee estimate withheld.</b> {quote.windowProblem}</div>
          ) : null}
          {quote.fees?.zeroVolume && <p className="muted l-tiny" data-testid="lp-zero">No measured volume in this complete 24 hour window. The fee estimate is zero.</p>}

          <section className="calc-il" data-testid="lp-platform">
            <h3>Quasaria deposit and withdraw costs</h3>
            {feeOn && quote.platform.enabled ? (
              <>
                <p className="muted">This build charges {(FEE_BPS / 100).toFixed(2)}% of each asset sent on deposit, and {(FEE_BPS / 100).toFixed(2)}% of each asset received on a later withdraw of these same amounts (price unchanged). This is not pool-fee income and is not subtracted from the estimate above.</p>
                <ul className="calc-notes">
                  {quote.platform.deposit.map((l) => <li key={`d-${l.code}`}>Deposit cost: {fmtAmt(l.amount)} {l.code}</li>)}
                  {quote.platform.withdraw.map((l) => <li key={`w-${l.code}`}>Withdraw cost, same amounts: {fmtAmt(l.amount)} {l.code}</li>)}
                </ul>
                <p className="muted l-tiny">The fee is skipped when the fee wallet cannot receive that asset. This preview does not look the wallet up.</p>
              </>
            ) : feeOn ? <p className="muted">This build charges {(FEE_BPS / 100).toFixed(2)}% on deposit and on withdraw. Enter a deposit to see the amounts. They are not subtracted from pool fees.</p>
              : <p className="muted">The Quasaria deposit and withdraw fee is off in this build.</p>}
          </section>

          {quote.il && (
            <div className="calc-il" data-testid="lp-il">
              <h3>Price scenario, not a forecast</h3>
              <p className="muted l-tiny">Impermanent loss compares the pool position with holding the same two amounts if {quote.codeA}'s price in {quote.codeB} moves by the factor you set. Fees are not included in this comparison.</p>
              <div className="calc-results il">
                <CalcStat label="Scenario result vs holding" tone={quote.il.ilPct < -1e-9 ? "neg" : undefined} testId="lp-il-pct">{pctStr(quote.il.ilPct, 2)}<span className="calc-usd">{quote.il.changePct > 0 ? "+" : ""}{quote.il.changePct}% price ({quote.il.k.toFixed(2)}×)</span></CalcStat>
                <CalcStat label="Just holding">{fmtAmt(quote.il.hold)} <span className="unit">{quote.il.code}</span></CalcStat>
                <CalcStat label="In the pool, fees excluded">{fmtAmt(quote.il.lp)} <span className="unit">{quote.il.code}</span></CalcStat>
              </div>
            </div>
          )}

          <ul className="calc-notes">
            <li>Each swap is counted once, in {quote.depositValue?.code ?? "one asset"} only. The other side of the same trade is not added.</li>
            <li>Daily fee = 24h volume × pool fee × your share after this deposit. A 30-day figure is daily × 30. A yearly figure is daily × 365, simple, not compounded.</li>
            <li>Volume and your share are assumed constant, and the fee leg assumes prices stay put. Past trades are not a promise of future fees.</li>
            {variant === "full" && <li>The loss figure uses 2·√k / (1 + k) − 1. It ignores fees, later deposits, and the path prices took to get there.</li>}
          </ul>
          {onOpenPool && <button type="button" className="btn small" disabled={!canOpen} onClick={onOpenPool}>Open this pool to deposit</button>}
        </>
      )}
      <div className="notice" role="note" data-testid="lp-no-incentive">
        <b>No liquidity-provider incentive.</b> Quasaria does not pay a separate reward on pool shares. {REWARD_ASSET_CODE} holder rewards ({REWARD_RATE_TEXT}) are not paid on pool shares. They are paid only on the wallet balance. Moving {REWARD_ASSET_CODE} into a pool reduces the qualifying wallet balance.
        {glacierMoved && <span data-testid="lp-glacierq-moved"> This deposit would move {fmtAmt(glacierMoved.amount)} {glacierMoved.code} out of the wallet while it stays in the pool.</span>}
      </div>
      <CalcDisclaimer />
    </div>
  );
}

export default function LpCalculator({ variant = "full", net = NETWORK, pricing = { xlmUsd: null }, defer = false, onOpenPool }: LpCalcProps) {
  const liveXlm = useLiveXlmUsd(5 * 60_000, OFFLINE_DEMO || net !== "mainnet");
  const xlmUsd = net === "mainnet" ? (liveXlm?.price && liveXlm.price > 0 ? liveXlm.price : pricing.xlmUsd && pricing.xlmUsd > 0 ? pricing.xlmUsd : null) : null;
  const priced = useMemo(() => ({ xlmUsd }), [xlmUsd]);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!defer);
  const pairs = useMemo(() => curatedPairs(net), [net]);
  const [pairIdx, setPairIdx] = useState(() => defaultPairIndex(net, pairs));
  useEffect(() => { setPairIdx(defaultPairIndex(net, pairs)); }, [net, pairs]);
  const [idText, setIdText] = useState("");
  const [amount, setAmount] = useState("");
  const [driver, setDriver] = useState<"A" | "B">("A");
  const [change, setChange] = useState(0);
  const [load, setLoad] = useState<Load>(idleLoad);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reloadN, setReloadN] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!defer) return;
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [defer]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const idTrim = idText.trim();
  const idMode = variant === "full" && idTrim.length > 0;
  const idOk = /^[0-9a-f]{64}$/i.test(idTrim);
  const blocked = idMode && !idOk;
  const pair = pairs[pairIdx] ?? pairs[0] ?? null;
  const selKey = idMode ? `id:${idTrim.toLowerCase()}` : pair ? `pair:${keyOf(pair[0])}|${keyOf(pair[1])}` : "none";

  useEffect(() => {
    if (!visible || blocked || OFFLINE_DEMO) return;
    const my = ++seq.current;
    setLoad({ phase: "loading", pool: null, walk: null });
    const pricingNow = priced;
    (async () => {
      try {
        const pool = idMode ? await fetchPoolById(net, idTrim.toLowerCase()) : pair ? await fetchPoolForPair(net, pair[0], pair[1]) : null;
        if (seq.current !== my) return;
        if (!pool) { setLoad({ phase: "missing", pool: null, walk: null }); return; }
        if (!(pool.reserveA > 0) || !(pool.reserveB > 0)) { setLoad({ phase: "ready", pool, walk: null }); return; }
        const vu = volumeUnit(pool, pricingNow);
        const walk = await fetchTradeWindow(NETS[net].horizon, pool.id, vu.unit, Date.now());
        if (seq.current !== my) return;
        setLoad({ phase: "ready", pool, walk });
      } catch {
        if (seq.current !== my) return;
        setLoad({ phase: "error", pool: null, walk: null });
      }
    })();
    return () => { seq.current += 1; };
    // pricing.xlmUsd changes the volume unit; the object identity does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, blocked, selKey, net, priced.xlmUsd, reloadN]);

  useEffect(() => {
    if (blocked || OFFLINE_DEMO) setLoad(idleLoad());
  }, [blocked, OFFLINE_DEMO]);

  const unit = load.pool ? volumeUnit(load.pool, priced) : null;
  const deposit = Number(String(amount).replace(/[, _]/g, ""));
  const quote = useMemo(() => {
    if (load.phase === "missing") {
      return quoteNativeLp({ pool: null, walk: null, nowMs, deposit, driver, unitCode: "A", unitIsA: true, usdPerUnit: null, platform: { enabled: feeEnabled(), bps: FEE_BPS }, priceChangePct: change });
    }
    if (load.phase !== "ready" || !load.pool || !unit) return null;
    const unitIsA = sameAsset(unit.unit, load.pool.a);
    return quoteNativeLp({
      pool: { reserveA: load.pool.reserveA, reserveB: load.pool.reserveB, feeBp: load.pool.feeBp, codeA: load.pool.a.code, codeB: load.pool.b.code },
      walk: load.walk, nowMs, deposit, driver, unitCode: unit.unit.code, unitIsA, usdPerUnit: unit.usd,
      platform: { enabled: feeEnabled(), bps: FEE_BPS }, priceChangePct: change,
    });
  }, [load, unit, nowMs, deposit, driver, change]);

  const glacierMoved = useMemo(() => {
    if (!load.pool || !quote?.amountA || !quote.amountB) return null;
    if (isRewardAsset(load.pool.a.code, load.pool.a.issuer)) return { code: load.pool.a.code, amount: quote.amountA };
    if (isRewardAsset(load.pool.b.code, load.pool.b.issuer)) return { code: load.pool.b.code, amount: quote.amountB };
    return null;
  }, [load.pool, quote]);

  const codeA = load.pool?.a.code ?? pair?.[0].code ?? "A";
  const codeB = load.pool?.b.code ?? pair?.[1].code ?? "B";
  const controls = (
    <div className="calc-grid">
      <div>
        <div className="field">
          <label htmlFor="lp-pair">Pool on {NETS[net].label}</label>
          <select id="lp-pair" className="input" value={String(pairIdx)} onChange={(e) => { setIdText(""); setPairIdx(Number(e.target.value)); }} aria-label="Liquidity pool" data-testid="lp-pair" disabled={!pairs.length}>
            {pairs.map(([a, b], i) => <option key={`${keyOf(a)}|${keyOf(b)}`} value={i}>{pairLabel(a, b)}</option>)}
          </select>
          <div className="calc-hint">{IS_MAINNET ? "Mainnet native pools. " : "This build reads native pools on its active network. "}Pick a pair. Nothing is fetched for the other pairs.</div>
        </div>
        {variant === "full" && (
          <div className="field">
            <label htmlFor="lp-pool-id">Or a pool id</label>
            <input id="lp-pool-id" className="input mono" value={idText} onChange={(e) => setIdText(e.target.value.trim())} placeholder="64 hex characters" aria-label="Pool id" data-testid="lp-pool-id" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            {blocked && <div className="calc-hint">Enter all 64 hex characters, or clear this field to use the pair list.</div>}
          </div>
        )}
        <div className="field">
          <span className="muted l-tiny">Amount of one side</span>
          <div className="calc-chips" role="group" aria-label="Which asset you type">
            <button type="button" className={`chip ${driver === "A" ? "on" : ""}`} aria-pressed={driver === "A"} onClick={() => setDriver("A")}>{codeA}</button>
            <button type="button" className={`chip ${driver === "B" ? "on" : ""}`} aria-pressed={driver === "B"} onClick={() => setDriver("B")}>{codeB}</button>
          </div>
        </div>
        <AmountField label={`Amount of ${driver === "A" ? codeA : codeB}`} value={amount} onChange={setAmount} unit={driver === "A" ? codeA : codeB} testId="lp-amount" hint={<>The other asset is filled at the current pool ratio. Reserves of zero are not replaced with an example pool.</>} />
        <button type="button" className="btn small ghost" onClick={() => { setNowMs(Date.now()); setReloadN((n) => n + 1); }}>Refresh this pool</button>
      </div>
      <div>
        <div className="field">
          <label htmlFor="lp-price-change">Price scenario: {codeA} in {codeB} {change > 0 ? "+" : ""}{change}%</label>
          <input id="lp-price-change" type="range" min={-90} max={400} step={1} value={change} onChange={(e) => setChange(Number(e.target.value))} aria-label="Price change scenario" data-testid="lp-price-change" />
          <div className="calc-chips">
            {IL_PRESETS.map((p) => <button key={p.label} type="button" className={`chip ${change === p.pct ? "on" : ""}`} onClick={() => setChange(p.pct)}>{p.label}</button>)}
          </div>
        </div>
      </div>
    </div>
  );

  const offline = OFFLINE_DEMO ? "Network reads are off in this session, so the fee rate is withheld." : null;
  const loadError = offline ?? (load.phase === "error" ? "Horizon could not be read, so daily, monthly, yearly fees and the annualized rate are withheld." : null);

  return (
    <div ref={root}>
      <LpQuoteBody
        variant={variant}
        loading={load.phase === "loading"}
        loadError={loadError}
        quote={blocked || offline ? null : quote}
        reserves={load.pool ? { reserveA: load.pool.reserveA, reserveB: load.pool.reserveB, feeBp: load.pool.feeBp, codeA: load.pool.a.code, codeB: load.pool.b.code, id: load.pool.id } : null}
        controls={controls}
        glacierMoved={glacierMoved}
        onOpenPool={onOpenPool && load.pool ? () => onOpenPool(load.pool!.id) : undefined}
        canOpen={!!load.pool}
      />
    </div>
  );
}
