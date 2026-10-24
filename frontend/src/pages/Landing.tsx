/**
 * Public landing page ("/"). Copy comes verbatim from docs/landing-outline.md.
 * Real data where it exists (stellarchain.io, Horizon/Soroban testnet, the
 * generated stablecoin pair list, deployed contract IDs); everything
 * illustrative is labelled as an example / estimate / simulation.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SpaceYeti from "../components/SpaceYeti";
import "../theme/space-yeti.css";
import { Link, useNavigate } from "react-router-dom";
import outlineMd from "../../../docs/landing-outline.md?raw";
import pairsDoc from "../../../docs/stablecoin-pairs.json";
import { POOL_LIST, assetById } from "../lib/assets";
import logo from "../assets/logo-light.svg";
import WorldBackground, { type Scene } from "../world/WorldBackground";
import WorldList from "../world/WorldList";
import WorldNav from "../world/WorldNav";
import { MainNav, MobileMenu } from "../components/Layout";
const Globe = lazy(() => import("../world/Globe"));
import AccountModal from "../components/AccountModal";
import OrderBook from "../components/OrderBook";
import WorldMap, { type MapPin } from "../components/WorldMap";
import { AssetLogo, Sparkline } from "../components/AssetBits";
import XlmMark from "../components/XlmMark";
import { FeedBadge } from "../components/ui";
import { NewsStrip } from "../components/News";
import { hms, useLiveXlmUsd } from "../lib/liveMarkets";
import { parseOutline } from "../lib/landingCopy";
import { SIZZLE_COPY } from "../lib/sizzle";
import { FEATURE_VIDEOS_COPY } from "../lib/featureVideos";
import FeatureVideos from "../components/FeatureVideos";
import ExplainerVideo from "../components/ExplainerVideo";
import { useWallet } from "../lib/wallet";
import { loadMarkets, useXlmUsd, type MarketRow, type MarketsResult } from "../lib/markets";
import { asOf, snapshotLabel, STELLARCHAIN_ATTRIBUTION } from "../lib/stellarchain";
import { ASSETS, fetchOrderBook, horizon } from "../lib/stellar";
import { readPool, useChain, type PoolInfo } from "../lib/chain";
import { CONTRACTS, OFFLINE_DEMO, NETWORK, IS_MAINNET, USDC_ISSUER, HORIZON_URL } from "../lib/config";
import { ammAmountOut } from "../lib/math";
import { REWARD_ASSET_CODE, REWARD_DISCLOSURE, REWARD_ISSUER, REWARD_TOTAL_SUPPLY, TOKENOMICS, dailyReward, tierFor, pctYear } from "../lib/rewards";
import { fmt, fmtCompact, short } from "../lib/format";
import { explorerAccountUrl } from "../lib/explorer";
import type { Book } from "../lib/demo";

const COPY = parseOutline(outlineMd);
const [POOL_XLM_QUSD = ""] = CONTRACTS.pools;
const S = (n: number) => COPY.find((c) => c.n === n) ?? { n, title: "", headline: "", pitch: "", visual: "" };

type Pair = (typeof pairsDoc.pairs)[number];
const PAIRS = pairsDoc.pairs as Pair[];
const VERIFIED = PAIRS.filter((p) => p.verified && p.primary);
// v3 asset pools (the v2 XLM/stablecoin pools are retired; see deployments/testnet-assets.json → retired)
const TESTNET_POOLS = POOL_LIST.map((p) => ({ pool: p.pool, code: p.base, mock: assetById(p.base)?.testnet.kind === "mirror" }));

// ---------------------------------------------------------------- shell bits
function Section({ id, n, scene, onScene, children, kicker, wide, unnumbered, headline, pitch }: { id: string; n: number; scene: Scene; onScene: (s: Scene) => void; children: ReactNode; kicker?: string; wide?: boolean; unnumbered?: boolean; headline?: string; pitch?: string }) {
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
      <div className="l-kicker">{unnumbered ? kicker ?? c.title : <>{String(n).padStart(2, "0")} · {kicker ?? c.title}</>}</div>
      <h2 id={`${id}-h`} className="l-h2">{headline ?? c.headline}</h2>
      <p className="l-pitch">{pitch ?? c.pitch}</p>
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
  // Live XLM/USD from Stellar mainnet Horizon (XLM/USDC, Circle issuer), shared with the app header ticker
  // and the Markets feed (liveMarkets); the stellarchain.io / snapshot value below is the fallback.
  const live = useLiveXlmUsd(5 * 60_000, OFFLINE_DEMO);
  if (live?.price)
    return (
      <span className="pill cyan l-ticker" title={`XLM/USD live from Stellar mainnet Horizon (XLM/USDC order book, Circle USDC) · updated ${hms(live.at)}`} data-testid="hero-xlm-ticker" data-feed="live">
        <XlmMark size={16} />XLM/USD <b className="mono">${live.price.toFixed(4)}</b>
        <span className="muted">live · Stellar mainnet</span>
      </span>
    );
  if (!x?.price) return <span className="pill">XLM · loading…</span>;
  return (
    <span className="pill cyan l-ticker" data-testid="hero-xlm-ticker" data-feed={x.feed === "snapshot" ? "snapshot" : "fallback"} title={`source: ${x.source === "stellarchain" ? "stellarchain.io" : "Horizon testnet (fallback)"}${x.updatedAt ? ` · as of ${x.updatedAt}` : ""}`}>
      <XlmMark size={16} />XLM/USD <b className="mono">${x.price.toFixed(4)}</b>
      <span className="muted">{x.source === "stellarchain" ? (x.feed === "snapshot" ? `stellarchain.io · ${snapshotLabel(x.snapshotAt)}` : "stellarchain.io") : "Horizon"}{x.updatedAt && x.feed !== "snapshot" ? ` · ${asOf(x.updatedAt)}` : ""}{x.stale ? " · stale" : ""}</span>
    </span>
  );
}

/** "Your keys, your XLM" lives in a prominent strip directly beneath the hero (the hero copy itself is fixed). */
export function KeysStrip() {
  const w = useWallet();
  return (
    <section className="card glow l-keysstrip" aria-labelledby="keys-strip-h" data-testid="keys-strip">
      <div className="l-keysstrip-copy">
        <h2 id="keys-strip-h" className="l-h2">Your keys, your XLM.</h2>
        <p className="l-pitch">Quasaria never holds your keys or your XLM when you trade: you hold the secret key and sign everything in your own browser. Nobody can recover it for you, so save it.</p>
      </div>
      <div className="l-keysstrip-cta">
        {!w.address && <button className="btn" onClick={() => w.openModal("create")}>Create a keypair</button>}
        {w.address && <Link className="btn ghost" to="/wallet" data-testid="keys-wallet-link">Send / receive</Link>}
        <a className="btn ghost" href="#keys">How your keys work</a>
      </div>
    </section>
  );
}

function CtaButtons() {
  const w = useWallet();
  return (
    <div className="l-ctas">
      <Link to="/exchange" className="btn" data-testid="cta-exchange">Exchange</Link>
      <Link to="/swap" className="btn ghost" data-testid="cta-swap">Swap</Link>
      {w.address ? (
        <Link to="/exchange" className="btn ghost">● {short(w.address, 5)} ready</Link>
      ) : (
        <button className="btn ghost" onClick={() => w.openModal("create")}>Create an account</button>
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
  const tradeNet = NETWORK;
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
    if (net !== tradeNet) return nav("/markets");
    const isUsdc = r.code === "USDC" && r.issuer === USDC_ISSUER;
    nav(isUsdc ? "/exchange" : `/exchange?base=${encodeURIComponent(r.key)}&quote=XLM`);
  };
  return (
    <div className="card">
      <div className="row between l-wrap">
        <div className="tabs" style={{ margin: 0 }}>
          <button className={net === "mainnet" ? "on" : ""} onClick={() => setNet("mainnet")}>{IS_MAINNET ? "Mainnet · tradeable" : "Mainnet · reference"}</button>
          {!IS_MAINNET && <button className={net === "testnet" ? "on" : ""} onClick={() => setNet("testnet")}>Testnet · tradeable</button>}
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

// ---------------------------------------------------------------- news (15 in the outline)
function NewsPreview() {
  return <NewsStrip />;
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
        <Link to="/exchange" className="btn block">Open Exchange</Link>
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
    { t: "Trade", d: `Sign transactions locally. ${IS_MAINNET ? "A new mainnet account opens once it receives at least 1 XLM." : "On testnet, Friendbot funds your new account with free test XLM."}`, i: "⇄" },
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
        {!w.address && <button className="btn" onClick={() => w.openModal("create")}>Create an account</button>}
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
                  <td><b>{p.label}</b> {p.mock && <span className="pill l-tiny">testnet mirror of {p.label.split("/")[1]}</span>}</td>
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
        <p className="muted l-tiny">Estimate only, not a promise: it assumes the volume you entered, constant prices and your pool share at today's live reserves. It ignores impermanent loss, Withdraw any time.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 7. holder rewards (GLACIERQ)
function RewardsVisual() {
  const [bal, setBal] = useState(5_000_000);
  const t = tierFor(bal);
  const daily = dailyReward(bal);
  return (
    <div className="l-grid-2">
      <div className="card" data-testid="rewards-tiers">
        <div className="row between"><h3 style={{ margin: 0 }}>Tiers</h3><Label kind="example">published terms</Label></div>
        <table className="t" style={{ marginTop: 8 }}>
          <thead><tr><th>Balance</th><th>Rate (per year)</th><th>Paid</th></tr></thead>
          <tbody>
            <tr><td className="mono">1M to under 10M</td><td className="mono">~5%</td><td>daily</td></tr>
            <tr><td className="mono">10M and up</td><td className="mono">~7%</td><td>daily</td></tr>
            <tr><td className="mono muted">under 1M</td><td className="mono muted">none</td><td className="muted">n/a</td></tr>
          </tbody>
        </table>
        <p className="muted l-tiny">Daily reward = rate ÷ 365 × your whole balance, paid in {REWARD_ASSET_CODE} by an ordinary payment from a finite reward reserve ({fmtCompact(TOKENOMICS.rewardReserve)} of a fixed {fmtCompact(REWARD_TOTAL_SUPPLY)} supply). No smart contract. A daily cap of {fmtCompact(TOKENOMICS.dailyCap)} can scale rewards down.</p>
        <Link to="/holders" className="btn ghost small" style={{ marginTop: 6, display: "inline-block" }}>Holder rewards →</Link>
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Daily reward estimator</h3><Label kind="estimate" /></div>
        <div className="field" style={{ marginTop: 12 }}><label>Your {REWARD_ASSET_CODE} balance</label><input className="input" type="number" min={0} value={bal} onChange={(e) => setBal(Math.max(0, Number(e.target.value)))} /></div>
        <div className="l-est">
          <div><span className="muted l-tiny">Tier</span><b className="mono">{t ? `${t.name} · ${pctYear(t.apr)}%/yr` : "below 1M"}</b></div>
          <div><span className="muted l-tiny">Reward / day</span><b className="mono">{fmt(daily, 2)} {REWARD_ASSET_CODE}</b></div>
          <div><span className="muted l-tiny">Reward / 30 days</span><b className="mono">{fmt(daily * 30, 2)}</b></div>
        </div>
        <div className="notice" role="note" data-testid="rewards-disclosure" style={{ marginTop: 10 }}><b>Plainly:</b> {REWARD_DISCLOSURE}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 8. open data
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

// ---------------------------------------------------------------- 9. transparency
function TransparencyVisual() {
  const links: [string, string][] = [
    [`Stellar network (Horizon, ${NETWORK})`, HORIZON_URL],
    [`Explorer (StellarChain.io, ${NETWORK})`, IS_MAINNET ? "https://stellarchain.io" : "https://testnet.stellarchain.io"],
    ...(REWARD_ISSUER[NETWORK] ? ([[`${REWARD_ASSET_CODE} issuer (${NETWORK})`, explorerAccountUrl(REWARD_ISSUER[NETWORK]!, NETWORK) ?? "https://stellarchain.io"]] as [string, string][]) : []),
  ];
  return (
    <div className="card">
      <div className="l-contracts">
        {links.map(([label, href]) => (
          <a key={label} className="l-contract" href={href} target="_blank" rel="noreferrer"><span>{label}</span><span className="mono l-tiny">↗</span></a>
        ))}
      </div>
      <p className="muted l-tiny">Quasaria runs on Stellar's own order book and liquidity pools, and holder rewards are plain payments you can verify on the ledger. There is no custom smart contract for you to trust. Listed assets are matched by issuer address (not by ticker) against each issuer's stellar.toml; see the <Link to="/pools">Pools page</Link>.</p>
      <div className="l-audit" role="note"><b>Audit status:</b> not yet audited.</div>
    </div>
  );
}

// ---------------------------------------------------------------- 10. FAQ
const FAQ: { q: string; a: ReactNode }[] = [
  { q: "What happens if I lose my secret key?", a: "Your account and everything in it are gone for good. Quasaria never sees or stores your key, so nobody (including us) can recover it. Write it down or save the backup file somewhere safe. \"Remember on this device\" is a convenience, not a backup." },
  { q: "What are the fees?", a: "Every Stellar transaction pays a tiny network fee (the base fee is 0.00001 XLM per operation; contract calls cost a little more). Swaps through a Stellar liquidity pool pay a 0.30% pool fee to the liquidity providers. Quasaria itself charges no fee on order-book or pool swaps." },
  { q: "Is my money safe?", a: `You keep custody of your keys, so nobody can freeze or move your funds without them. But Quasaria is experimental and not yet audited: liquidity pools can lose value to impermanent loss, reward tokens dilute supply, and prices can move fast. ${IS_MAINNET ? "It runs on Stellar mainnet with real funds." : "During the beta it runs on Stellar testnet, where tokens have no real value."}` },
  { q: "Is this live on mainnet?", a: IS_MAINNET ? `Yes. Quasaria runs on Stellar mainnet: trades use real XLM and assets, and you sign every transaction with your own key. The software is not yet audited. ${REWARD_ASSET_CODE} has not been issued yet.` : "Not yet. Quasaria is a testnet beta: testnet XLM is free from Friendbot. Mainnet market data is shown for reference only." },
  { q: "Why don't I see some stablecoins?", a: "We only list coins whose issuer's stellar.toml confirms the exact code and issuer, with enough holders and trading activity. Look-alikes and impostors are rejected. Unverified coins are hidden behind a \"show unverified\" toggle on the Pools page, with a warning." },
  { q: "Do I need a browser extension?", a: "No. There are no wallet extensions or third-party connectors: you create an account in the page (your browser generates the keypair) or log in by pasting an existing secret key." },
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

export default function Landing() {
  const w = useWallet();
  const [scene, setScene] = useState<Scene>("quasar");
  const onScene = useMemo(() => (s: Scene) => setScene(s), []);
  useEffect(() => {
    document.title = "Quasaria — Trade on the Stellar Decentralized Exchange";
  }, []);
  const hero = S(1);
  const cta = S(11);
  return (
    <>
      <WorldBackground scene={scene} />
      <div className="app landing">
        <header className="topbar l-top">
          <Link to="/" className="brand" aria-label="Quasaria home"><img src={logo} alt="" /><span className="word">Quasaria</span></Link>
          <WorldNav />
          <MainNav path="/" />
          <MobileMenu path="/" />
          <Ticker />
          <Link to="/exchange" className="btn small">Launch app</Link>
        </header>
        {w.modalOpen && <AccountModal />}
        <main className="l-main">
          <section className="l-hero" aria-labelledby="hero-h">
            <div className="l-hero-copy">
              <span className="net-badge">{IS_MAINNET ? "Stellar Mainnet" : "Testnet beta"}</span>
              <h1 id="hero-h" className="l-h1">{hero.headline}</h1>
              <p className="l-pitch big">{hero.pitch}</p>
              <CtaButtons />
              <div className="l-hero-meta"><Ticker /><span className="muted l-tiny">Not yet audited · runs on Stellar {IS_MAINNET ? "mainnet" : "testnet"}</span><SpaceYeti prop="coin" className="sy-inline" /></div>
            </div>
            <div className="l-hero-art">
              <Suspense fallback={<div className="globe-loading" aria-hidden />}><Globe /></Suspense>
            </div>
          </section>

          <KeysStrip />

          <section className="l-world" aria-labelledby="world-h">
            <h2 id="world-h" className="l-h2">Explore the world of Quasaria</h2>
            <p className="l-pitch">Every feature is a district on the globe. Spin it, or pick a district below.</p>
            <WorldList label="All Quasaria districts" />
          </section>

          {/* Sizzle reel: not part of the 15-section approved outline, so its copy lives in lib/sizzle.ts */}
          <Section id="watch" n={0} scene="quasar" onScene={onScene} kicker={SIZZLE_COPY.kicker} headline={SIZZLE_COPY.headline} pitch={SIZZLE_COPY.pitch} unnumbered><ExplainerVideo name="quasaria-home-tour" title="Quasaria tour" testid="home-video" note="About 1½ minutes · captions are part of the video." /></Section>
          <Section id="feature-videos" n={0} scene="quasar" onScene={onScene} kicker={FEATURE_VIDEOS_COPY.kicker} headline={FEATURE_VIDEOS_COPY.headline} pitch={FEATURE_VIDEOS_COPY.pitch} unnumbered><FeatureVideos /></Section>
          <Section id="markets" n={2} scene="constellation" onScene={onScene}><MarketsPreview /></Section>
          <Section id="news" n={12} scene="constellation" onScene={onScene} kicker="News" unnumbered><NewsPreview /></Section>
          <Section id="trade" n={3} scene="quasar" onScene={onScene}><TradePreview /></Section>
          <Section id="keys" n={4} scene="constellation" onScene={onScene} kicker="Your keys, your coins"><KeysVisual /></Section>
          <Section id="stablecoins" n={5} scene="nebula" onScene={onScene}><StablecoinVisual /></Section>
          <Section id="earn" n={6} scene="nebula" onScene={onScene}><LiquidityVisual /></Section>
          <Section id="rewards" n={7} scene="supernova" onScene={onScene}><RewardsVisual /></Section>
          <Section id="data" n={8} scene="constellation" onScene={onScene}><OpenDataVisual /></Section>
          <Section id="security" n={9} scene="orbits" onScene={onScene}><TransparencyVisual /></Section>
          <Section id="faq" n={10} scene="nebula" onScene={onScene}><FaqVisual /></Section>

          <section className="l-final" aria-labelledby="final-h">
            <img src={logo} alt="" width={84} />
            <h2 id="final-h" className="l-h2">{cta.headline}</h2>
            <p className="l-pitch">{cta.pitch}</p>
            <CtaButtons />
          </section>
        </main>
        <footer className="l-footer">
          <span className="foot-brand"><img src={logo} alt="" />Quasaria</span>
          <p><b>Risk disclosure.</b> Quasaria is experimental software. Nothing on this site is financial advice. Liquidity pools and token rewards carry real risk of loss and may be regulated where you live.</p>
          <p><b>Audit status:</b> not yet audited. {IS_MAINNET ? "Runs on Stellar mainnet with real funds." : "Testnet beta: tokens on Stellar testnet have no real value."}</p>
          <p className="muted">{STELLARCHAIN_ATTRIBUTION} · Settlement: Stellar network · <a href="https://stellarchain.io" target="_blank" rel="noopener noreferrer">StellarChain.io</a> · <Link to="/exchange">Launch app</Link></p>
        </footer>
      </div>
    </>
  );
}
