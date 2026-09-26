import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FeedBadge, PageHead, Stat, Tabs } from "../components/ui";
import { AssetLogo, Sparkline } from "../components/AssetBits";
import { loadMarkets, useXlmUsd, type MarketRow, type MarketsResult } from "../lib/markets";
import { asOf, snapshotLabel, STELLARCHAIN_ATTRIBUTION, stellarchain, type MarketOverview, type ScNetwork } from "../lib/stellarchain";
import { OFFLINE_DEMO, TESTNET_USDC_ISSUER } from "../lib/config";
import { fmt, fmtCompact } from "../lib/format";

const chg = (v: number | null) => (v === null ? <span className="muted">—</span> : <span className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "+" : ""}{fmt(v, 2)}%</span>);
const priceFmt = (v: number) => (v >= 100 ? fmt(v, 2) : v >= 1 ? fmt(v, 4) : v >= 0.0001 ? fmt(v, 6) : v.toExponential(2));

export default function Markets() {
  const nav = useNavigate();
  const [network, setNetwork] = useState<ScNetwork>("testnet");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<MarketsResult | null>(null);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const xlm = useXlmUsd();

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (OFFLINE_DEMO) return;
    let alive = true;
    setData(null);
    loadMarkets(network, { itemsPerPage: 25, search: q || undefined }).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [network, q]);
  useEffect(() => {
    if (OFFLINE_DEMO) return;
    stellarchain.overview("mainnet").then(setOverview).catch(() => setOverview(null));
  }, []);

  const trade = (r: MarketRow) => {
    const isUsdc = r.code === "USDC" && r.issuer === TESTNET_USDC_ISSUER;
    nav(isUsdc ? "/trade" : `/trade?base=${encodeURIComponent(r.key)}&quote=XLM`);
  };

  return (
    <>
      <PageHead kicker="Scene · Constellations" title="Markets" right={<div className="row" style={{ gap: 8, flexWrap: "wrap" }}><span className="pill cyan">{STELLARCHAIN_ATTRIBUTION} · Horizon fallback</span><FeedBadge source={data?.source} snapshotAt={data?.snapshotAt} /></div>}>
        Discover Stellar assets ranked by stellarchain.io — price, momentum, volume and issuer info. Display data only: every trade still settles on the SDEX via Horizon or through Soroban.
      </PageHead>
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <div className="card"><Stat label="XLM / USD" value={xlm?.price ? `$${fmt(xlm.price, 4)}` : "—"} sub={xlm ? `${xlm.source === "stellarchain" ? (xlm.feed === "snapshot" ? `stellarchain.io · ${snapshotLabel(xlm.snapshotAt)}` : "stellarchain.io") : xlm.source === "horizon" ? "Horizon testnet (fallback)" : "unavailable"}${xlm.updatedAt ? ` · as of ${asOf(xlm.updatedAt)}` : ""}${xlm.stale ? " · stale" : ""}` : "loading…"} className="gold" /></div>
        <div className="card"><Stat label="Tracked assets" value={overview?.trackedAssets ? fmtCompact(overview.trackedAssets) : "—"} sub={overview ? `mainnet · as of ${asOf(overview.updatedAt)}${overview.source === "snapshot" ? ` · ${snapshotLabel(overview.snapshotAt)}` : ""}` : "stellarchain overview"} /></div>
        <div className="card"><Stat label="Accounts" value={overview?.totalAccounts ? fmtCompact(overview.totalAccounts) : "—"} sub="mainnet" /></div>
        <div className="card"><Stat label="Contracts" value={overview?.totalContracts ? fmtCompact(overview.totalContracts) : "—"} sub={overview && overview.trades24h === 0 ? "24h trades: 0 reported (snapshot may lag)" : "mainnet"} /></div>
      </div>
      <div className="card">
        <div className="row between" style={{ flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
          <Tabs value={network} onChange={setNetwork} options={[{ v: "testnet", label: "Testnet · tradeable here" }, { v: "mainnet", label: "Mainnet · reference" }]} />
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search code, issuer or org…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {data?.source === "snapshot" && <div className="notice" data-testid="snapshot-notice">The live stellarchain.io API isn't reachable from this site, so this table shows the {snapshotLabel(data.snapshotAt)} ({asOf(data.snapshotAt ?? "")}), fetched when the site was last deployed. Testnet prices are still refreshed from Horizon where possible.</div>}
        {data?.error && <div className="notice warn">stellarchain.io unavailable ({data.error}). {network === "testnet" ? "Showing nothing until it recovers; the Trade page keeps working from Horizon." : ""}</div>}
        <table className="t">
          <thead>
            <tr><th>#</th><th>Asset</th><th>Price (XLM)</th><th>≈ USD</th><th>1h</th><th>24h</th><th>7d</th><th>Vol 24h (XLM)</th><th>Trades</th><th>Trustlines</th><th>1h trend</th><th>As of</th><th /></tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={13} className="muted">Loading market data…</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.key} data-testid="market-row">
                <td className="mono muted">{r.rank ?? "—"}</td>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <AssetLogo code={r.code} logo={r.logo} />
                    <div style={{ minWidth: 0 }}>
                      <b>{r.code}</b>
                      <div className="muted" style={{ fontSize: "0.7rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.orgName ?? r.homeDomain ?? `${r.issuer.slice(0, 4)}…${r.issuer.slice(-4)}`}</div>
                    </div>
                  </div>
                </td>
                <td className="mono">{r.priceXlm !== null ? priceFmt(r.priceXlm) : <span className="muted">—</span>}{r.priceSource === "horizon" && <div className="muted" style={{ fontSize: "0.62rem" }}>Horizon book</div>}</td>
                <td className="mono">{network === "mainnet" && r.priceXlm !== null && xlm?.price ? `$${priceFmt(r.priceXlm * xlm.price)}` : <span className="muted">—</span>}</td>
                <td className="mono">{chg(r.change1h)}</td>
                <td className="mono">{chg(r.change24h)}</td>
                <td className="mono">{chg(r.change7d)}</td>
                <td className="mono">{r.volumeXlm24h !== null ? fmtCompact(r.volumeXlm24h) : "—"}</td>
                <td className="mono">{r.trades24h !== null ? fmtCompact(r.trades24h) : "—"}</td>
                <td className="mono">{r.trustlines !== null ? fmtCompact(r.trustlines) : "—"}</td>
                <td><Sparkline values={r.sparkline} /></td>
                <td style={{ fontSize: "0.72rem" }} className={r.stale ? "neg" : "muted"} title={r.priceAsOf ?? r.updatedAt}>{asOf(r.priceAsOf ?? r.updatedAt)}{r.stale ? " · stale" : ""}</td>
                <td>{network === "testnet" ? <button className="btn small ghost" onClick={() => trade(r)}>Trade</button> : <span className="muted" style={{ fontSize: "0.7rem" }}>ref only</span>}</td>
              </tr>
            ))}
            {data && !data.rows.length && !data.error && <tr><td colSpan={13} className="muted">No assets match.</td></tr>}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: "0.75rem", marginTop: 10 }}>
          Ranking, logos, org names and stats: <a href="https://stellarchain.io" target="_blank" rel="noreferrer">stellarchain.io</a> public API (cached 5 min; falls back to a build-time snapshot, labelled with its time, when the API can't be reached from the browser). Snapshots older than 24h are flagged <span className="neg">stale</span>; on testnet, missing/stale prices fall back to the Horizon order book vs XLM. Testnet prices come from sparse testnet order books and are not real market prices (so no USD conversion is shown). Mainnet rows are reference-only — Quasaria trades on TESTNET. Listing ≠ endorsement: always verify the issuer.
        </p>
      </div>
    </>
  );
}
