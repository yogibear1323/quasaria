/**
 * Public landing page ("/"). Copy comes verbatim from docs/landing-outline.md.
 * Real data where it exists (stellarchain.io, Horizon/Soroban testnet, the
 * generated stablecoin pair list, deployed contract IDs); everything
 * illustrative is labelled as an example / estimate / simulation.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import outlineMd from "../../../docs/landing-outline.md?raw";
import pairsDoc from "../../../docs/stablecoin-pairs.json";
import testnetStables from "../config/testnet-stablecoins.json";
import logo from "../assets/logo.svg";
import CosmicBackground, { type Scene } from "../components/CosmicBackground";
import AccountModal from "../components/AccountModal";
import OrderBook from "../components/OrderBook";
import WorldMap, { type MapPin } from "../components/WorldMap";
import { AssetLogo, Sparkline } from "../components/AssetBits";
import { FeedBadge, RiskWarning } from "../components/ui";
import { parseOutline } from "../lib/landingCopy";
import { useWallet } from "../lib/wallet";
import { loadMarkets, useXlmUsd, type MarketRow, type MarketsResult } from "../lib/markets";
import { asOf, snapshotLabel, STELLARCHAIN_ATTRIBUTION } from "../lib/stellarchain";
import { ASSETS, fetchOrderBook, horizon } from "../lib/stellar";
import { readPool, readQfx, readReferrals, readStaking, useChain, type PoolInfo } from "../lib/chain";
import { CONTRACTS, CONTRACTS_CONFIGURED, DEMO_ACCOUNTS, expertContract, OFFLINE_DEMO, TESTNET_USDC_ISSUER, symbolOf } from "../lib/config";
import { ammAmountOut, projectBalance } from "../lib/math";
import { fmt, fmtCompact, short } from "../lib/format";
import type { Book } from "../lib/demo";

const COPY = parseOutline(outlineMd);
const [POOL_XLM_QUSD = "", POOL_QFX_QUSD = ""] = CONTRACTS.pools;
const S = (n: number) => COPY.find((c) => c.n === n) ?? { n, title: "", headline: "", pitch: "", visual: "" };

type Pair = (typeof pairsDoc.pairs)[number];
const PAIRS = pairsDoc.pairs as Pair[];
const VERIFIED = PAIRS.filter((p) => p.verified && p.primary);
type TStable = { code: string; mainnetCode: string; mock: boolean; pool?: string; label: string };
const TESTNET_POOLS = ((testnetStables as { pools?: TStable[] }).pools ?? []).filter((p) => p.pool);

// ---------------------------------------------------------------- shell bits
function Section({ id, n, scene, onScene, children, kicker, wide }: { id: string; n: number; scene: Scene; onScene: (s: Scene) => void; children: ReactNode; kicker?: string; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && onScene(scene)), { rootMargin: "-45% 0px -45% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [scene, onScene]);
  const c = S(n);
  return (
    <section id={id} ref={ref} className={`l-section ${wide ? "wide" : ""}`} aria-labelledby={`${id}-h`}>
      <div className="l-kicker">{String(n).padStart(2, "0")} · {kicker ?? c.title}</div>
      <h2 id={`${id}-h`} className="l-h2">{c.headline}</h2>
      <p className="l-pitch">{c.pitch}</p>
      <div className="l-visual">{children}</div>
    </section>
  );
}

const Label = ({ kind, children }: { kind: "live" | "example" | "estimate" | "simulated" | "preview"; children?: ReactNode }) => (
  <span className={`l-label ${kind}`}>
    {kind === "live" ? "● live" : kind === "example" ? "Example · illustration" : kind === "estimate" ? "Estimate · not a promise" : kind === "simulated" ? "Simulated · not a prediction" : "Preview"}
    {children ? <> · {children}</> : null}
  </span>
);

function Ticker() {
  const x = useXlmUsd();
  if (!x?.price) return <span className="pill">XLM · loading…</span>;
  return (
    <span className="pill cyan l-ticker" title={`source: ${x.source === "stellarchain" ? "stellarchain.io" : "Horizon testnet (fallback)"}${x.updatedAt ? ` · as of ${x.updatedAt}` : ""}`}>
      XLM/USD <b className="mono">${x.price.toFixed(4)}</b>
      <span className="muted">{x.source === "stellarchain" ? (x.feed === "snapshot" ? `stellarchain.io · ${snapshotLabel(x.snapshotAt)}` : "stellarchain.io") : "Horizon"}{x.updatedAt && x.feed !== "snapshot" ? ` · ${asOf(x.updatedAt)}` : ""}{x.stale ? " · stale" : ""}</span>
    </span>
  );
}

function CtaButtons() {
  const w = useWallet();
  return (
    <div className="l-ctas">
      <Link to="/trade" className="btn">Launch app</Link>
      {w.address ? (
        <Link to="/trade" className="btn ghost">● {short(w.address, 5)} ready</Link>
      ) : (
        <button className="btn ghost" onClick={() => w.openModal("create")}>Create a wallet</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 2. markets
const priceFmt = (v: number) => (v >= 100 ? fmt(v, 2) : v >= 1 ? fmt(v, 4) : v >= 0.0001 ? fmt(v, 6) : v.toExponential(2));
const chg = (v: number | null) => (v === null ? <span className="muted">—</span> : <span className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "+" : ""}{fmt(v, 2)}%</span>);

function MarketsPreview() {
  const nav = useNavigate();
  const xlm = useXlmUsd();
  const [net, setNet] = useState<"mainnet" | "testnet">("mainnet");
  const [data, setData] = useState<MarketsResult | null>(null);
  useEffect(() => {
    if (OFFLINE_DEMO) return;
    let alive = true;
    setData(null);
    loadMarkets(net, { itemsPerPage: 8, enrich: 8 }).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [net]);
  const open = (r: MarketRow) => {
    if (net === "mainnet") return nav("/markets");
    const isUsdc = r.code === "USDC" && r.issuer === TESTNET_USDC_ISSUER;
    nav(isUsdc ? "/trade" : `/trade?base=${encodeURIComponent(r.key)}&quote=XLM`);
  };
  return (
    <div className="card">
      <div className="row between l-wrap">
        <div className="tabs" style={{ margin: 0 }}>
          <button className={net === "mainnet" ? "on" : ""} onClick={() => setNet("mainnet")}>Mainnet · reference</button>
          <button className={net === "testnet" ? "on" : ""} onClick={() => setNet("testnet")}>Testnet · tradeable</button>
        </div>
        {data?.source && data.source !== "live" ? <FeedBadge source={data.source} snapshotAt={data.snapshotAt} /> : <Label kind="live">{STELLARCHAIN_ATTRIBUTION}</Label>}
      </div>
      <div className="l-scroll">
        <table className="t l-click">
          <thead><tr><th>Asset</th><th>Price (XLM)</th>{net === "mainnet" && <th>≈ USD</th>}<th>24h</th><th>Vol 24h</th><th>Trend</th><th>As of</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={7} className="muted">Loading market data…</td></tr>}
            {data?.error && <tr><td colSpan={7} className="muted">stellarchain.io unavailable right now ({data.error}).</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.key} onClick={() => open(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(r)} title={net === "mainnet" ? "Mainnet is reference only: opens the Markets page" : "Open on the Trade page"}>
                <td><div className="row" style={{ gap: 8 }}><AssetLogo code={r.code} logo={r.logo} size={22} /><div><b>{r.code}</b><div className="muted l-tiny">{r.orgName ?? r.homeDomain ?? short(r.issuer)}</div></div></div></td>
                <td className="mono">{r.priceXlm !== null ? priceFmt(r.priceXlm) : "—"}</td>
                {net === "mainnet" && <td className="mono">{r.priceXlm !== null && xlm?.price ? `$${priceFmt(r.priceXlm * xlm.price)}` : "—"}</td>}
                <td className="mono">{chg(r.change24h)}</td>
                <td className="mono">{r.volumeXlm24h !== null ? fmtCompact(r.volumeXlm24h) : "—"}</td>
                <td><Sparkline values={r.sparkline} /></td>
                <td className={`l-tiny ${r.stale ? "neg" : "muted"}`}>{asOf(r.priceAsOf ?? r.updatedAt)}{r.stale ? " · stale" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted l-tiny" style={{ marginTop: 8 }}>
        Display data from the stellarchain.io public API, cached 5 minutes; if the API can't be reached from this site, a snapshot fetched at build time is shown and labelled with its time. Stale rows are flagged. Mainnet rows are for reference; Quasaria trades on Stellar testnet during the beta. <Link to="/markets">All markets →</Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- 3. trade
function TradePreview() {
  const [book, setBook] = useState<Book | null>(null);
  const [ledger, setLedger] = useState<{ seq: number; gap: number | null } | null>(null);
  const pool = useChain(() => readPool(POOL_XLM_QUSD), []);
  const [amt, setAmt] = useState(100);
  useEffect(() => {
    fetchOrderBook(ASSETS.XLM, ASSETS.USDC, true).then(setBook);
    if (OFFLINE_DEMO) return;
    horizon.ledgers().order("desc").limit(2).call().then((r) => {
      const [a, b] = r.records;
      setLedger({ seq: a.sequence, gap: b ? (Date.parse(a.closed_at) - Date.parse(b.closed_at)) / 1000 : null });
    }).catch(() => void 0);
  }, []);
  const p = pool.data;
  const xlmIsA = p ? p.tokenA === CONTRACTS.xlmSac : true;
  const out = p ? ammAmountOut(amt, xlmIsA ? p.reserveA : p.reserveB, xlmIsA ? p.reserveB : p.reserveA, p.feeBps) : null;
  return (
    <div className="l-grid-2">
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>SDEX order book · XLM/USDC</h3>{book && <Label kind={book.source === "horizon" ? "live" : "example"}>{book.source === "horizon" ? "Horizon testnet" : "demo book"}</Label>}</div>
        {book ? <OrderBook book={{ ...book, bids: book.bids.slice(0, 6), asks: book.asks.slice(0, 6) }} base="XLM" quote="USDC" /> : <p className="muted">Loading order book…</p>}
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Swap · XLM → QUSD</h3><Label kind={pool.live ? "live" : "example"}>{pool.live ? "Soroban pool reserves" : "loading"}</Label></div>
        <div className="field" style={{ marginTop: 12 }}><label>You pay (XLM)</label><input className="input" type="number" min={0} value={amt} onChange={(e) => setAmt(Math.max(0, Number(e.target.value)))} /></div>
        <div className="field"><label>You receive (QUSD, quote)</label><div className="input mono">{out !== null ? fmt(out, 4) : "—"}</div></div>
        <p className="muted l-tiny">Quote from the live XLM/QUSD AMM pool on testnet{p ? ` (reserves ${fmtCompact(xlmIsA ? p.reserveA : p.reserveB)} XLM / ${fmtCompact(xlmIsA ? p.reserveB : p.reserveA)} QUSD, fee ${p.feeBps / 100}%)` : ""}. QUSD is Quasaria's testnet demo stablecoin.</p>
        <div className="l-settle" aria-label="Animation: an order settling on the ledger">
          <span className="s1">✍ Signed</span><span className="s2">→ Submitted</span><span className="s3">→ In ledger ✓</span>
        </div>
        <p className="muted l-tiny">Animation. {ledger ? <>Latest testnet ledger <b className="mono">#{ledger.seq.toLocaleString()}</b>{ledger.gap ? <>, closed {fmt(ledger.gap, 1)}s after the previous one</> : null} (live from Horizon).</> : "Stellar ledgers close about every five seconds."}</p>
        <Link to="/trade" className="btn block">Open Trade</Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 4. keys
function KeysVisual() {
  const w = useWallet();
  const steps = [
    { t: "Generate", d: "Your browser creates a secret key and public address with Web Crypto. Nothing is sent anywhere.", i: "✦" },
    { t: "Back up", d: "Save the secret, then prove it with a quick backup check. Optionally encrypt it on this device with a password.", i: "lock" },
    { t: "Trade", d: "Sign transactions locally. On testnet, Friendbot funds your new account with free test XLM.", i: "⇄" },
  ];
  return (
    <div>
      <div className="l-steps">
        {steps.map((s, i) => (
          <div key={s.t} className="card l-step" style={{ animationDelay: `${i * 1.2}s` }}>
            <div className="l-step-n">{i + 1}</div>
            <div className="l-step-i">{s.i === "lock" ? <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg> : s.i}</div>
            <h3>{s.t}</h3>
            <p className="muted">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="l-callout">
        <div className="l-callout-big">What we store about you: nothing.</div>
        <p className="muted">No server-side accounts, emails or key copies. If you tick "remember on this device", the encrypted key stays in your own browser's storage (PBKDF2-SHA256 → AES-256-GCM).</p>
        {!w.address && <button className="btn" onClick={() => w.openModal("create")}>Create a wallet</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 5. stablecoins
const PEG_GEO: Record<string, { lat: number; lon: number; name: string; below?: boolean }> = {
  USD: { lat: 39, lon: -98, name: "US dollar" },
  EUR: { lat: 51, lon: 10, name: "Euro area" },
  CHF: { lat: 46, lon: 8, name: "Switzerland", below: true },
  ARS: { lat: -35, lon: -63, name: "Argentina" },
  CLP: { lat: -31, lon: -71, name: "Chile", below: true },
  PEN: { lat: -10, lon: -75, name: "Peru" },
  BRL: { lat: -11, lon: -51, name: "Brazil" },
  ZAR: { lat: -29, lon: 25, name: "South Africa" },
  NGN: { lat: 9, lon: 8, name: "Nigeria" },
  IDR: { lat: -3, lon: 117, name: "Indonesia" },
  JPY: { lat: 36, lon: 138, name: "Japan" },
  AUD: { lat: -25, lon: 134, name: "Australia" },
};

function StablecoinVisual() {
  const byPeg = useMemo(() => {
    const m = new Map<string, Pair[]>();
    for (const p of VERIFIED) m.set(p.peg, [...(m.get(p.peg) ?? []), p]);
    return m;
  }, []);
  const pins: MapPin[] = [...byPeg.entries()].filter(([peg]) => PEG_GEO[peg]).map(([peg, ps]) => ({
    lat: PEG_GEO[peg].lat, lon: PEG_GEO[peg].lon, below: PEG_GEO[peg].below, label: peg, local: peg !== "USD" && peg !== "EUR",
    title: `${PEG_GEO[peg].name}: ${ps.map((p) => p.code).join(", ")}`,
  }));
  const local = [...byPeg.entries()].filter(([peg]) => peg !== "USD" && peg !== "EUR" && PEG_GEO[peg]);
  return (
    <div>
      <div className="l-coins">
        {VERIFIED.map((p) => (
          <div key={p.assetKey} className="card l-coin" title={`${p.code} · issuer ${p.issuer} · ${p.domain}`}>
            <AssetLogo code={p.code} logo={p.logo} size={40} />
            <b>XLM/{p.code}</b>
            <span className="muted l-tiny">{p.domain}</span>
            <span className="muted l-tiny">{fmtCompact(p.holders)} holders · {p.peg}</span>
            {p.verification === "verified" ? (
              <span className="pill green l-badge" title="The issuer's stellar.toml lists this exact code and issuer">✔ Verified by issuer</span>
            ) : (
              <span className="pill cyan l-badge" title="The issuer's stellar.toml could not be fetched (circle.com returns 404), so this issuer is allowlisted in config/stablecoins.json">✔ Allowlisted issuer</span>
            )}
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="row between l-wrap"><h3 style={{ margin: 0 }}>Local-currency coins</h3><span className="l-tiny muted"><span style={{ color: "var(--plasma)" }}>●</span> local currency · <span style={{ color: "var(--quasar)" }}>●</span> USD / EUR</span></div>
        <WorldMap pins={pins} />
        <p className="muted l-tiny" style={{ margin: 0 }}>{local.map(([peg, ps]) => `${PEG_GEO[peg].name}: ${ps.map((p) => p.code).join(", ")}`).join(" · ")}</p>
      </div>
      <p className="muted l-tiny" style={{ marginTop: 10 }}>
        {VERIFIED.length} verified stablecoins, auto-discovered from the stellarchain.io feed (data as of {new Date(pairsDoc.asOf).toUTCString().slice(5, 16)}). Each is checked against its issuer's stellar.toml; {pairsDoc.rejected.length} look-alikes and low-activity tokens were rejected. Mainnet issuers are listed for reference; on testnet, USDC is Circle's real testnet coin and the others are labelled mock tokens. <Link to="/pools">See the pools →</Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- 6. liquidity
type PoolRow = { id: string; label: string; mock: boolean; info: PoolInfo };
async function readLandingPools(): Promise<PoolRow[]> {
  const list = [{ id: POOL_XLM_QUSD, label: "XLM/QUSD", mock: false }, ...TESTNET_POOLS.slice(0, 5).map((p) => ({ id: p.pool!, label: `XLM/${p.code}`, mock: p.mock }))];
  const rows = await Promise.all(list.map(async (l) => ({ ...l, info: await readPool(l.id) })));
  return rows;
}

function LiquidityVisual() {
  const pools = useChain(readLandingPools, []);
  const [sel, setSel] = useState(0);
  const [deposit, setDeposit] = useState(1000);
  const [volume, setVolume] = useState(2_000);
  const row = pools.data?.[sel];
  const xlmSide = row ? (row.info.tokenA === CONTRACTS.xlmSac ? row.info.reserveA : row.info.reserveB) : 0;
  const tvlXlm = xlmSide * 2;
  const share = row ? deposit / (tvlXlm + deposit) : 0;
  const feeRate = row ? row.info.feeBps / 10_000 : 0.003;
  const daily = volume * feeRate * share;
  return (
    <div className="l-grid-2">
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Pools on testnet</h3><Label kind={pools.live ? "live" : "example"}>{pools.loading ? "reading…" : pools.live ? "Soroban reserves" : "unavailable"}</Label></div>
        <table className="t l-click" style={{ marginTop: 8 }}>
          <thead><tr><th>Pool</th><th>Reserves</th><th>Fee</th></tr></thead>
          <tbody>
            {pools.data?.map((p, i) => {
              const xa = p.info.tokenA === CONTRACTS.xlmSac;
              return (
                <tr key={p.id} onClick={() => setSel(i)} className={i === sel ? "l-sel" : ""}>
                  <td><b>{p.label}</b> {p.mock && <span className="pill l-tiny">MOCK</span>}</td>
                  <td className="mono l-tiny">{fmtCompact(xa ? p.info.reserveA : p.info.reserveB)} XLM / {fmtCompact(xa ? p.info.reserveB : p.info.reserveA)}</td>
                  <td className="mono">{p.info.feeBps / 100}%</td>
                </tr>
              );
            })}
            {!pools.data && <tr><td colSpan={3} className="muted">{pools.loading ? "Reading pools…" : "Pools unavailable."}</td></tr>}
          </tbody>
        </table>
        <Link to="/pools" className="btn ghost small" style={{ marginTop: 10, display: "inline-block" }}>All pools →</Link>
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Fee estimator {row ? `· ${row.label}` : ""}</h3><Label kind="estimate" /></div>
        <div className="field" style={{ marginTop: 12 }}><label>Your deposit (total value, XLM)</label><input className="input" type="number" min={0} value={deposit} onChange={(e) => setDeposit(Math.max(0, Number(e.target.value)))} /></div>
        <div className="field"><label>Assumed daily swap volume (XLM) · your assumption</label><input type="range" min={0} max={100_000} step={500} value={volume} onChange={(e) => setVolume(Number(e.target.value))} /><span className="mono l-tiny">{fmt(volume, 0)} XLM / day</span></div>
        <div className="l-est">
          <div><span className="muted l-tiny">Pool share</span><b className="mono">{fmt(share * 100, 2)}%</b></div>
          <div><span className="muted l-tiny">Est. fees / day</span><b className="mono">{fmt(daily, 3)} XLM</b></div>
          <div><span className="muted l-tiny">Est. fees / 30 days</span><b className="mono">{fmt(daily * 30, 2)} XLM</b></div>
          <div><span className="muted l-tiny">Est. APR</span><b className="mono">{deposit > 0 ? fmt((daily * 365 / deposit) * 100, 2) : "0.00"}%</b></div>
        </div>
        <p className="muted l-tiny">Estimate only, not a promise: it assumes the volume you entered, constant prices and your pool share at today's live reserves. It ignores impermanent loss, and when a trader was referred, 20% of that trade's fee goes to their referrer. Withdraw any time by burning your QLP share tokens.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 7. staking
function StakingVisual() {
  const st = useChain(() => readStaking(""), []);
  const [lock, setLock] = useState(30);
  const [amount, setAmount] = useState(10_000);
  const exampleApr = 0.06 + 0.1 * (lock / 90); // purely illustrative curve
  const reward = amount * exampleApr * (Math.max(lock, 30) / 365);
  return (
    <div className="l-grid-2">
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Lock period</h3><Label kind="example">made-up rates</Label></div>
        <div className="field" style={{ marginTop: 12 }}><label>Stake (tokens)</label><input className="input" type="number" min={0} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} /></div>
        <div className="field"><label>Lock: {lock === 0 ? "flexible (no lock)" : `${lock} days`}</label><input type="range" min={0} max={90} step={1} value={lock} onChange={(e) => setLock(Number(e.target.value))} /></div>
        <div className="l-est">
          <div><span className="muted l-tiny">Example rate</span><b className="mono">{fmt(exampleApr * 100, 1)}% / yr</b></div>
          <div><span className="muted l-tiny">Example reward over {Math.max(lock, 30)} days</span><b className="mono">{fmt(reward, 2)}</b></div>
        </div>
        <p className="muted l-tiny">Illustration of how a longer lock can earn a higher rate. These numbers are made up; real reward rates are set per staking pool on-chain, depend on how much is staked, and can change.</p>
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Staking pools on testnet</h3><Label kind={st.live ? "live" : "example"}>{st.live ? "staking contract" : st.loading ? "reading…" : "unavailable"}</Label></div>
        {st.data?.pools.map((p) => (
          <div key={p.id} className="l-pool">
            <div><b>Pool {p.id}</b> <span className="muted">stake {symbolOf(p.stakeToken)} → earn {symbolOf(p.rewardToken)}</span></div>
            <div className="mono l-tiny">{p.lockDays > 0 ? `${fmt(p.lockDays, 0)}-day lock` : "flexible"} · {fmt(p.ratePerSec * 86_400, 0)} {symbolOf(p.rewardToken)}/day to all stakers · {fmtCompact(p.totalStaked)} staked · {fmtCompact(p.reserve)} reward reserve</div>
          </div>
        ))}
        {!st.data && <p className="muted">{st.loading ? "Reading staking pools…" : "Staking pools unavailable."}</p>}
        <Link to="/stake" className="btn ghost small" style={{ marginTop: 10, display: "inline-block" }}>Open Stake →</Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 8. QFX
function QfxVisual() {
  const q = useChain(() => readQfx(""), []);
  const aprBps = q.data?.aprBps ?? 1200;
  const principal = 1000;
  const days = 365;
  const pts = Array.from({ length: days + 1 }, (_, d) => projectBalance(principal, aprBps, d));
  const max = pts[pts.length - 1];
  const W = 560, H = 200;
  const path = pts.map((v, d) => `${d === 0 ? "M" : "L"}${(d / days) * W},${H - ((v - principal) / Math.max(1e-9, max - principal)) * (H - 20) - 10}`).join(" ");
  return (
    <div className="l-grid-2">
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>1 QFX = 1 XLM, fully backed</h3>{q.live ? <Label kind="live">live reserves</Label> : <Label kind="example">loading</Label>}</div>
        <div className="l-est" style={{ marginTop: 12 }}>
          <div><span className="muted l-tiny">XLM reserve</span><b className="mono">{q.data ? fmt(q.data.xlmReserve, 2) : "—"}</b></div>
          <div><span className="muted l-tiny">QFX supply</span><b className="mono">{q.data ? fmt(q.data.totalSupply, 2) : "—"}</b></div>
          <div><span className="muted l-tiny">Backing</span><b className="mono">{q.data && q.data.totalSupply > 0 ? `${fmt((q.data.xlmReserve / q.data.totalSupply) * 100, 2)}%` : "—"}</b></div>
        </div>
        <div className="row between" style={{ marginTop: 14 }}><h3 style={{ margin: 0, fontSize: "1rem" }}>Holding {fmt(principal, 0)} QFX for a year</h3><Label kind="example">example numbers</Label></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="l-chart" role="img" aria-label="Illustrative reward curve">
          <defs><linearGradient id="qfxg" x1="0" x2="1"><stop offset="0" stopColor="#ffd166" /><stop offset=".5" stopColor="#ff3dcb" /><stop offset="1" stopColor="#9b5cff" /></linearGradient></defs>
          <path d={`${path} L${W},${H} L0,${H} Z`} fill="rgba(255,61,203,.08)" />
          <path d={path} fill="none" stroke="url(#qfxg)" strokeWidth={3} />
        </svg>
        <div className="l-est">
          <div><span className="muted l-tiny">Day 0</span><b className="mono">{fmt(principal, 2)}</b></div>
          <div><span className="muted l-tiny">Day 30</span><b className="mono">{fmt(pts[30], 2)}</b></div>
          <div><span className="muted l-tiny">Day 365</span><b className="mono">{fmt(max, 2)}</b></div>
        </div>
        <p className="muted l-tiny">Illustration only: assumes the rate stays at {fmt(aprBps / 100, 2)}% APR ({q.live ? "the current on-chain rate" : "the deployed default"}), yield is credited daily, and the reward reserve lasts the whole year. The rate is variable and capped at {fmt((q.data?.maxAprBps ?? 2500) / 100, 2)}%; when the reserve runs out, yield stops.</p>
      </div>
      <div className="card">
        <h3>How the backing and the yield work</h3>
        <ol className="l-ol">
          <li><b>Mint:</b> deposit XLM and the contract mints exactly the same amount of QFX. <b>Redeem:</b> burn QFX and get the same amount of XLM back. There is no admin mint.</li>
          <li>The contract's XLM balance always equals QFX total supply; anyone can check it with the <span className="mono">reserves()</span> view.</li>
          <li>Holder yield is <b>paid from a reward reserve</b> that was pre-funded with testnet XLM{q.data ? ` (${fmtCompact(q.data.rewardPool)} QFX left on testnet)` : ""}. Paying it moves existing QFX; it never creates unbacked tokens.</li>
          <li>The APR is capped by the contract. When the reserve is empty, yield stops until someone tops it up.</li>
        </ol>
        {q.live && <Label kind="live">APR {fmt(aprBps / 100, 2)}% · reserve = supply {q.data!.raw.xlmReserve === q.data!.raw.totalSupply ? "✓" : "✗"}</Label>}
        <div style={{ marginTop: 12 }}><Link to="/rewards" className="btn ghost small">Mint / Redeem QFX →</Link></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 9. bots
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Strat = "grid" | "dca" | "momentum";
function simulate(strat: Strat, lev: number, seed: number) {
  const r = mulberry(seed);
  const prices = [0.12];
  for (let i = 1; i < 180; i++) prices.push(Math.max(0.02, prices[i - 1] * (1 + (r() - 0.495) * 0.03)));
  let equity = 100;
  const curve = [equity];
  let liquidated = false;
  for (let i = 1; i < prices.length; i++) {
    const ret = prices[i] / prices[i - 1] - 1;
    let exposure = 0;
    if (strat === "momentum") {
      const w = prices.slice(Math.max(0, i - 12), i);
      const ma = w.reduce((a, b) => a + b, 0) / w.length;
      exposure = prices[i - 1] > ma ? 1 : -1;
    } else if (strat === "dca") exposure = Math.min(1, i / 60);
    else exposure = prices[i - 1] < 0.12 ? 1 : -1; // mean-revert around the grid centre
    if (!liquidated) {
      equity *= 1 + ret * exposure * lev - (strat === "grid" ? 0.0002 : 0.0001);
      if (equity <= 5) {
        equity = 0;
        liquidated = true;
      }
    }
    curve.push(equity);
  }
  return { curve, liquidated };
}

function BotsVisual() {
  const [strat, setStrat] = useState<Strat>("grid");
  const [lev, setLev] = useState(3);
  const [seed, setSeed] = useState(7);
  const sim = useMemo(() => simulate(strat, lev, seed), [strat, lev, seed]);
  const W = 560, H = 180;
  const max = Math.max(...sim.curve, 100), min = Math.min(...sim.curve, 100);
  const y = (v: number) => H - ((v - min) / Math.max(1e-9, max - min)) * (H - 16) - 8;
  const path = sim.curve.map((v, i) => `${i ? "L" : "M"}${(i / (sim.curve.length - 1)) * W},${y(v)}`).join(" ");
  const final = sim.curve[sim.curve.length - 1];
  return (
    <div>
      <RiskWarning>Leverage multiplies losses as well as gains: at {lev}× a {fmt(100 / lev, 1)}% move against you can wipe out your margin, and positions are liquidated when the health factor drops below 1.0. Bots can malfunction or act on stale prices. Quasaria is unaudited, experimental software on testnet. This is not financial advice, and leveraged trading may be restricted where you live.</RiskWarning>
      <div className="l-grid-2">
        <div className="card">
          <h3>Strategy</h3>
          <div className="tabs">
            {(["grid", "dca", "momentum"] as Strat[]).map((s) => <button key={s} className={s === strat ? "on" : ""} onClick={() => setStrat(s)}>{s === "dca" ? "DCA" : s[0].toUpperCase() + s.slice(1)}</button>)}
          </div>
          <p className="muted l-tiny">{strat === "grid" ? "Grid: places a ladder of buy and sell orders around a centre price and profits from chop." : strat === "dca" ? "DCA: buys a fixed amount on a schedule, averaging the entry price." : "Momentum: goes long above a moving average and short below it."}</p>
          <div className="field"><label>Leverage: {lev}×</label><input type="range" min={1} max={20} value={lev} onChange={(e) => setLev(Number(e.target.value))} /></div>
          <p className="muted l-tiny">Stop-loss and take-profit levels are stored with the position and enforced on-chain by the vault via a keeper. A bot key authorised as your operator can open and close positions for you; only you can withdraw. The testnet vault is currently deployed with a 10× cap.</p>
          <Link to="/bots" className="btn ghost small">Open Bots &amp; Leverage →</Link>
        </div>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Performance preview</h3><Label kind="simulated" /></div>
          <svg viewBox={`0 0 ${W} ${H}`} className="l-chart" role="img" aria-label="Simulated equity curve">
            <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="rgba(169,166,216,.35)" strokeDasharray="4 6" />
            <path d={path} fill="none" stroke={final >= 100 ? "#3dffa8" : "#ff4d6d"} strokeWidth={2.5} />
          </svg>
          <div className="row between l-wrap">
            <span className="mono">Start 100 → end <b className={final >= 100 ? "pos" : "neg"}>{fmt(final, 1)}</b>{sim.liquidated ? " · LIQUIDATED" : ""}</span>
            <button className="btn ghost small" onClick={() => setSeed((s) => s + 1)}>New random path</button>
          </div>
          <p className="muted l-tiny">Simulated on a synthetic random price path. It is not a backtest, not a prediction and not what a real bot will do. Try a few paths: the same strategy can win or lose.</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 10. referrals
function ReferralVisual() {
  const w = useWallet();
  const [addr, setAddr] = useState("");
  const [copied, setCopied] = useState(false);
  const who = addr || w.address || "";
  const valid = /^G[A-Z2-7]{55}$/.test(who);
  const link = valid ? `${window.location.origin}${import.meta.env.BASE_URL}?ref=${who}` : "";
  const refs = useChain(() => readReferrals(DEMO_ACCOUNTS.lp), []);
  return (
    <div className="l-grid-2">
      <div className="card">
        <h3>Your referral link</h3>
        <div className="field"><label>Your Stellar address (G…)</label><input className="input" placeholder={w.address ?? "G…"} value={addr} onChange={(e) => setAddr(e.target.value.trim())} /></div>
        <div className="row l-wrap">
          <input className="input mono" readOnly value={link || (who ? "Not a valid Stellar address" : "Enter your address or create a wallet")} />
          <button className="btn small" disabled={!valid} onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => void 0)}>{copied ? "Copied ✦" : "Copy"}</button>
        </div>
        <p className="muted l-tiny">Friends who open your link can register you as their referrer, once and on-chain. From then on the referral contract automatically pays you 20% of the fees their swaps and positions pay.</p>
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Earnings dashboard</h3><Label kind="preview">{refs.live ? "live numbers of the public demo referrer" : "loading"}</Label></div>
        <div className="l-est" style={{ marginTop: 10 }}>
          <div><span className="muted l-tiny">Referred accounts</span><b className="mono">{refs.data ? refs.data.count : "—"}</b></div>
          <div><span className="muted l-tiny">Fee share</span><b className="mono">{refs.data ? `${refs.data.shareBps / 100}%` : "20%"}</b></div>
          {refs.data?.earned.map((e) => <div key={e.token}><span className="muted l-tiny">Earned {symbolOf(e.token)}</span><b className="mono">{fmt(e.amount, 4)}</b></div>)}
        </div>
        <p className="muted l-tiny">Testnet demo account {short(DEMO_ACCOUNTS.lp, 5)}. <Link to="/referrals">Your dashboard →</Link></p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 11. open data
function OpenDataVisual() {
  return (
    <div className="card">
      <div className="l-flow">
        <div className="l-node"><b>stellarchain.io</b><span className="muted l-tiny">public data feed: prices, 24h moves, volume, logos, issuer info</span></div>
        <div className="l-arrow">→ display only →</div>
        <div className="l-node core"><img src={logo} alt="" width={40} /><b>Quasaria app</b><span className="muted l-tiny">runs in your browser; signs locally</span></div>
        <div className="l-arrow">→ signed transactions →</div>
        <div className="l-node"><b>Stellar network</b><span className="muted l-tiny">Horizon (SDEX order books, native pools) · Soroban RPC (Quasaria contracts)</span></div>
        <div className="l-arrow">→ settles on →</div>
        <div className="l-node"><b>The ledger</b><span className="muted l-tiny">public, verifiable on any explorer</span></div>
      </div>
      <p className="muted l-tiny" style={{ marginTop: 10 }}>Market data courtesy of <a href="https://stellarchain.io" target="_blank" rel="noreferrer">stellarchain.io</a>. It is shown for discovery only and never used to price trades: swaps use on-chain pool reserves and order books.</p>
    </div>
  );
}

// ---------------------------------------------------------------- 12. transparency
const CONTRACT_LIST: [string, string][] = [
  ["Router", CONTRACTS.router], ["AMM pool XLM/QUSD", POOL_XLM_QUSD], ["AMM pool QFX/QUSD", POOL_QFX_QUSD], ["Staking", CONTRACTS.staking], ["QFX (1:1 XLM-backed)", CONTRACTS.qfx],
  ["Referral registry", CONTRACTS.referral], ["Leverage vault", CONTRACTS.vault], ["Price oracle (mock)", CONTRACTS.oracle], ["QUSD token (SAC)", CONTRACTS.qusdSac], ["XLM token (SAC)", CONTRACTS.xlmSac],
];
function TransparencyVisual() {
  return (
    <div className="card">
      <div className="l-contracts">
        {CONTRACT_LIST.filter(([, id]) => id).map(([label, id]) => (
          <a key={label} className="l-contract" href={expertContract(id)} target="_blank" rel="noreferrer">
            <span>{label}</span><span className="mono l-tiny">{short(id, 6)} ↗</span>
          </a>
        ))}
      </div>
      <p className="muted l-tiny">Deployed on Stellar testnet; links open stellar.expert. Plus {TESTNET_POOLS.length} XLM/stablecoin AMM pools listed on the <Link to="/pools">Pools page</Link>.{!CONTRACTS_CONFIGURED ? " (Contracts not configured in this build.)" : ""}</p>
      <div className="l-audit" role="note"><b>Audit status:</b> not yet audited.</div>
    </div>
  );
}

// ---------------------------------------------------------------- 13. FAQ
const FAQ: { q: string; a: ReactNode }[] = [
  { q: "What happens if I lose my secret key?", a: "Your account and everything in it are gone for good. Quasaria never sees or stores your key, so nobody (including us) can recover it. Write it down or save the backup file somewhere safe. \"Remember on this device\" is a convenience, not a backup." },
  { q: "What are the fees?", a: "Every Stellar transaction pays a tiny network fee (the base fee is 0.00001 XLM per operation; contract calls cost a little more). AMM swaps pay a 0.30% pool fee to liquidity providers, and if the trader was referred, 20% of that fee goes to their referrer. Opening a leveraged position costs 0.10% of its size. Quasaria charges no fee on SDEX order-book trades." },
  { q: "Is my money safe?", a: "You keep custody of your keys, so nobody can freeze or move your funds without them. But Quasaria is experimental and not yet audited: contracts can have bugs, leverage can liquidate your margin, and prices can move fast. During the beta it runs on Stellar testnet, where tokens have no real value." },
  { q: "Is this live on mainnet?", a: "Not yet. Quasaria is a testnet beta: testnet XLM is free from Friendbot. Mainnet market data is shown for reference only." },
  { q: "Why don't I see some stablecoins?", a: "We only list coins whose issuer's stellar.toml confirms the exact code and issuer, with enough holders and trading activity. Look-alikes and impostors are rejected. Unverified coins are hidden behind a \"show unverified\" toggle on the Pools page, with a warning." },
  { q: "Do I need a browser extension?", a: "No. You can create an account right in the page, import an existing secret key, or connect the Freighter wallet if you prefer." },
];
function FaqVisual() {
  return (
    <div className="l-faq">
      {FAQ.map((f, i) => (
        <details key={f.q} className="card" open={i === 0}>
          <summary>{f.q}</summary>
          <p className="muted">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- page
const NAV = [
  ["markets", "Markets"], ["stablecoins", "Stablecoins"], ["earn", "Earn"], ["bots", "Bots"], ["security", "Security"], ["faq", "FAQ"],
] as const;

export default function Landing() {
  const w = useWallet();
  const [scene, setScene] = useState<Scene>("quasar");
  const onScene = useMemo(() => (s: Scene) => setScene(s), []);
  useEffect(() => {
    document.title = "Quasaria · Trade at the speed of light on Stellar";
  }, []);
  const hero = S(1);
  const cta = S(14);
  return (
    <>
      <CosmicBackground scene={scene} />
      <div className="app landing">
        <header className="topbar l-top">
          <Link to="/" className="brand" aria-label="Quasaria home"><img src={logo} alt="" /><span className="word grad-text">QUASARIA</span></Link>
          <nav className="nav l-nav">{NAV.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
          <Ticker />
          <Link to="/trade" className="btn small">Launch app</Link>
        </header>
        {w.modalOpen && <AccountModal />}
        <main className="l-main">
          <section className="l-hero" aria-labelledby="hero-h">
            <div className="l-hero-copy">
              <span className="net-badge">Testnet beta</span>
              <h1 id="hero-h" className="l-h1">{hero.headline}</h1>
              <p className="l-pitch big">{hero.pitch}</p>
              <CtaButtons />
              <div className="l-hero-meta"><Ticker /><span className="muted l-tiny">Not yet audited · runs on Stellar testnet</span></div>
            </div>
            <div className="l-hero-art" aria-hidden>
              <div className="l-halo" />
              <img src={logo} alt="" className="l-hero-logo" />
            </div>
          </section>

          <Section id="markets" n={2} scene="constellation" onScene={onScene}><MarketsPreview /></Section>
          <Section id="trade" n={3} scene="quasar" onScene={onScene}><TradePreview /></Section>
          <Section id="keys" n={4} scene="constellation" onScene={onScene} kicker="Your keys, your coins"><KeysVisual /></Section>
          <Section id="stablecoins" n={5} scene="nebula" onScene={onScene}><StablecoinVisual /></Section>
          <Section id="earn" n={6} scene="nebula" onScene={onScene}><LiquidityVisual /></Section>
          <Section id="staking" n={7} scene="orbits" onScene={onScene}><StakingVisual /></Section>
          <Section id="qfx" n={8} scene="supernova" onScene={onScene}><QfxVisual /></Section>
          <Section id="bots" n={9} scene="warp" onScene={onScene}><BotsVisual /></Section>
          <Section id="referrals" n={10} scene="constellation" onScene={onScene}><ReferralVisual /></Section>
          <Section id="data" n={11} scene="constellation" onScene={onScene}><OpenDataVisual /></Section>
          <Section id="security" n={12} scene="orbits" onScene={onScene}><TransparencyVisual /></Section>
          <Section id="faq" n={13} scene="nebula" onScene={onScene}><FaqVisual /></Section>

          <section className="l-final" aria-labelledby="final-h">
            <img src={logo} alt="" width={84} />
            <h2 id="final-h" className="l-h2">{cta.headline}</h2>
            <p className="l-pitch">{cta.pitch}</p>
            <CtaButtons />
          </section>
        </main>
        <footer className="l-footer">
          <p><b>Risk disclosure.</b> Quasaria is experimental software. Nothing on this site is financial advice. Leverage and yield carry real risk of loss and may be regulated where you live.</p>
          <p><b>Audit status:</b> not yet audited. Testnet beta: tokens on Stellar testnet have no real value.</p>
          <p className="muted">{STELLARCHAIN_ATTRIBUTION} · Settlement: Stellar network · <a href="https://stellar.expert/explorer/testnet" target="_blank" rel="noreferrer">stellar.expert</a> · <Link to="/trade">Launch app</Link></p>
        </footer>
      </div>
    </>
  );
}
