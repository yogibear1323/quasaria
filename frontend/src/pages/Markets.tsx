import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AssetAbout from "../components/AssetAbout";
import { clampPage, filterRows, loadFullList, pageCount, PAGE_SIZE, searchBeyond, sortRows, type BeyondHit, type FullList, type SortKey } from "../lib/marketsFull";
import { FeedBadge, PageHead, Stat, Tabs } from "../components/ui";
import { AssetLogo, Sparkline } from "../components/AssetBits";
import { loadMarkets, useXlmUsd, type MarketRow, type MarketsResult } from "../lib/markets";
import { asOf, snapshotLabel, STELLARCHAIN_ATTRIBUTION, stellarchain, type MarketOverview, type ScNetwork } from "../lib/stellarchain";
import { hms, LIVE_ASSET_COUNT as LIVE_N, MAINNET_USDC_ISSUER, REFRESH_MS, snapshotRow, useLiveMarkets, type LiveRow } from "../lib/liveMarkets";
import { OFFLINE_DEMO, TESTNET_USDC_ISSUER } from "../lib/config";
import { fmt, fmtCompact } from "../lib/format";

const chg = (v: number | null) => (v === null ? <span className="muted">—</span> : <span className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "+" : ""}{fmt(v, 2)}%</span>);
const priceFmt = (v: number) => (v >= 100 ? fmt(v, 2) : v >= 1 ? fmt(v, 4) : v >= 0.0001 ? fmt(v, 6) : v.toExponential(2));
const snapTime = (at: string | null | undefined) => (at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "last deploy");
const SnapMark = ({ title }: { title: string }) => (
  <sup className="muted" style={{ fontSize: "0.55rem", marginLeft: 2, color: "var(--amber)" }} title={title}>snap</sup>
);

export default function Markets() {
  const nav = useNavigate();
  const [network, setNetwork] = useState<ScNetwork>("mainnet");
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => (params.get("q") ?? "").trim());
  const [full, setFull] = useState<FullList | null>(null);
  const [aboutKey, setAboutKey] = useState<string | null>(null);
  const [beyond, setBeyond] = useState<{ q: string; hits: BeyondHit[]; loading: boolean }>({ q: "", hits: [], loading: false });
  const sortKey = (["rank", "code", "price", "change24h", "change7d", "volume", "trades", "holders"].includes(params.get("sort") ?? "") ? params.get("sort") : "rank") as SortKey;
  const dir: "asc" | "desc" = params.get("dir") === "desc" ? "desc" : params.get("dir") === "asc" ? "asc" : sortKey === "rank" || sortKey === "code" ? "asc" : "desc";
  /** Update URL params (page/sort/q are shareable); search or sort changes go back to page 1. */
  const setUrl = (u: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(u)) (v === null || v === "" ? n.delete(k) : n.set(k, v));
    setParams(n, { replace: true });
  };
  const [data, setData] = useState<MarketsResult | null>(null);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [testnetByCode, setTestnetByCode] = useState<Map<string, string>>(new Map());
  const xlm = useXlmUsd();
  // Live Stellar MAINNET feed (Horizon), only while the mainnet tab is shown.
  const live = useLiveMarkets({ disabled: OFFLINE_DEMO || network !== "mainnet" });

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  const firstQ = useRef(true);
  useEffect(() => {
    if (firstQ.current) { firstQ.current = false; return; }
    setUrl({ q: q || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    if (OFFLINE_DEMO) return;
    loadFullList().then(setFull);
  }, []);
  useEffect(() => {
    if (OFFLINE_DEMO || network !== "testnet") return;
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
    // testnet asset per code (best-ranked), so a mainnet row's Trade button can open the matching TESTNET market
    stellarchain.loadSnapshot().then((s) => {
      const m = new Map<string, string>();
      for (const a of [...(s?.marketAssets?.testnet?.member ?? [])].sort((x, y) => (x.rankPosition ?? 1e9) - (y.rankPosition ?? 1e9))) if (!m.has(a.code)) m.set(a.code, a.assetKey);
      setTestnetByCode(m);
    });
  }, []);

  const trade = (r: MarketRow) => {
    const isUsdc = r.code === "USDC" && r.issuer === TESTNET_USDC_ISSUER;
    nav(isUsdc ? "/trade" : `/trade?base=${encodeURIComponent(r.key)}&quote=XLM`);
  };
  /** Mainnet rows are data only; Trade opens Quasaria's TESTNET market for the same code (or the default XLM/USDC pair). */
  const tradeMainnet = (r: LiveRow) => {
    const k = r.code === "USDC" ? null : testnetByCode.get(r.code);
    nav(k ? `/trade?base=${encodeURIComponent(k)}&quote=XLM` : "/trade");
  };

  /** Top 1,000: live Horizon values for the live-tracked top rows, saved list (30-min refresh) for the rest. */
  const allRows = useMemo(() => {
    if (!full?.assets.length) return live.rows;
    const byKey = new Map(live.rows.map((r) => [r.key, r]));
    const rows = full.assets.map((a) => byKey.get(a.key) ?? snapshotRow(a));
    const have = new Set(rows.map((r) => r.key));
    for (const r of live.rows) if (!have.has(r.key)) rows.push(r);
    return rows;
  }, [full, live.rows]);
  const sorted = useMemo(() => sortRows(filterRows(allRows, q), sortKey, dir), [allRows, q, sortKey, dir]);
  const pages = pageCount(sorted.length);
  const page = clampPage(Number(params.get("page") ?? 1), sorted.length);
  const liveRows = useMemo(() => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sorted, page]);
  const goPage = (p: number) => { setUrl({ page: p > 1 ? String(p) : null }); setAboutKey(null); document.getElementById("mk-table")?.scrollIntoView({ block: "start", behavior: "smooth" }); };
  const sortBy = (k: SortKey) => {
    const nextDir = sortKey === k ? (dir === "asc" ? "desc" : "asc") : k === "rank" || k === "code" ? "asc" : "desc";
    setUrl({ sort: k === "rank" && nextDir === "asc" ? null : k, dir: k === "rank" && nextDir === "asc" ? null : nextDir, page: null });
  };
  const keys = useMemo(() => new Set(allRows.map((r) => r.key)), [allRows]);
  useEffect(() => {
    if (network !== "mainnet" || OFFLINE_DEMO || q.length < 2) { setBeyond({ q: "", hits: [], loading: false }); return; }
    let alive = true;
    setBeyond({ q, hits: [], loading: true });
    const t = setTimeout(() => searchBeyond(q, keys).then((hits) => alive && setBeyond({ q, hits, loading: false })), 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, network, keys]);
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th aria-sort={sortKey === k ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`th-sort ${sortKey === k ? "on" : ""}`} onClick={() => sortBy(k)}>{children}{sortKey === k ? (dir === "asc" ? " ▲" : " ▼") : ""}</button>
    </th>
  );
  const Pager = ({ where }: { where: string }) => pages > 1 ? (
    <nav className="mk-pager" aria-label={`Market pages (${where})`} data-testid={`pager-${where}`}>
      <button type="button" className="pg-btn" onClick={() => goPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <button type="button" key={n} className={`pg-btn num ${n === page ? "on" : ""}`} aria-current={n === page ? "page" : undefined} aria-label={`Page ${n}, ranks ${(n - 1) * PAGE_SIZE + 1} to ${Math.min(n * PAGE_SIZE, sorted.length)}`} onClick={() => goPage(n)}>{n}</button>
      ))}
      <button type="button" className="pg-btn" onClick={() => goPage(page + 1)} disabled={page >= pages}>Next ›</button>
      <span className="muted mk-count" data-testid={`count-${where}`}>{sorted.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length.toLocaleString()}` : "0"}{q ? " matches" : " assets"}</span>
    </nav>
  ) : <p className="muted mk-count" data-testid={`count-${where}`}>{sorted.length.toLocaleString()} {q ? "matches" : "assets"}</p>;

  const liveXlm = network === "mainnet" && live.mode === "live" && live.xlmUsd?.price ? live.xlmUsd : null;
  // Mainnet: live XLM/USD, else the snapshot's mainnet reference price (never the testnet book). Testnet tab: unchanged source.
  const snapXlm = network === "mainnet" && !liveXlm && overview?.xlmPriceUsd ? overview : null;
  const usdPerXlm = network === "mainnet" ? (liveXlm?.price ?? snapXlm?.xlmPriceUsd ?? null) : (xlm?.price ?? null);
  const retryIn = live.nextAttemptAt ? Math.max(0, Math.round((live.nextAttemptAt - live.now) / 1000)) : null;

  const headRight =
    network === "mainnet" ? (
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {live.mode === "live" && (
          <>
            <span className="pill green" data-testid="live-badge">● Live · Stellar mainnet</span>
            <span className="pill mono" data-testid="live-updated" title={`Horizon mainnet, refreshed every ~${REFRESH_MS / 1000}s while this tab is visible`}>Updated {hms(live.updatedAt)}</span>
          </>
        )}
        {live.mode === "fallback" && <span className="pill gold" data-testid="feed-badge" title="stellarchain.io data saved when the site was last deployed">Snapshot from {snapTime(live.snapshotAt)}</span>}
        {live.mode === "loading" && <span className="pill cyan" data-testid="live-connecting">Connecting to Stellar mainnet…</span>}
      </div>
    ) : (
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><span className="pill cyan">{STELLARCHAIN_ATTRIBUTION} · Horizon fallback</span><FeedBadge source={data?.source} snapshotAt={data?.snapshotAt} /></div>
    );

  const xlmSub = liveXlm
    ? `live · Horizon mainnet XLM/USDC (Circle)${liveXlm.change24h !== null ? ` · 24h ${liveXlm.change24h >= 0 ? "+" : ""}${fmt(liveXlm.change24h, 2)}%` : ""}`
    : snapXlm
      ? `mainnet · stellarchain.io ${snapXlm.source === "snapshot" ? snapshotLabel(snapXlm.snapshotAt) : `as of ${asOf(snapXlm.updatedAt)}`}`
      : network === "mainnet"
        ? live.mode === "loading" ? "loading…" : "unavailable"
        : xlm
      ? `${xlm.source === "stellarchain" ? (xlm.feed === "snapshot" ? `stellarchain.io · ${snapshotLabel(xlm.snapshotAt)}` : "stellarchain.io") : xlm.source === "horizon" ? "Horizon testnet (fallback)" : "unavailable"}${xlm.updatedAt ? ` · as of ${asOf(xlm.updatedAt)}` : ""}${xlm.stale ? " · stale" : ""}`
      : "loading…";

  return (
    <>
      <PageHead kicker="Scene · Constellations" title="Markets" right={headRight}>
        {network === "mainnet"
          ? "Live Stellar mainnet market data straight from public Horizon — price, momentum, volume and holders. Display data only: trading on Quasaria is testnet-only, and every trade settles on the testnet SDEX or through Soroban."
          : "Discover Stellar assets ranked by stellarchain.io — price, momentum, volume and issuer info. Display data only: every trade still settles on the SDEX via Horizon or through Soroban."}
      </PageHead>
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <div className="card"><Stat label="XLM / USD" value={usdPerXlm ? `$${fmt(usdPerXlm, 4)}` : "—"} sub={xlmSub} className="gold" /></div>
        <div className="card"><Stat label="Tracked assets" value={overview?.trackedAssets ? fmtCompact(overview.trackedAssets) : "—"} sub={overview ? `mainnet · as of ${asOf(overview.updatedAt)}${overview.source === "snapshot" ? ` · ${snapshotLabel(overview.snapshotAt)}` : ""}` : "stellarchain overview"} /></div>
        <div className="card"><Stat label="Accounts" value={overview?.totalAccounts ? fmtCompact(overview.totalAccounts) : "—"} sub={overview?.source === "snapshot" ? `mainnet · stellarchain.io ${snapshotLabel(overview.snapshotAt)}` : "mainnet"} /></div>
        <div className="card"><Stat label="Contracts" value={overview?.totalContracts ? fmtCompact(overview.totalContracts) : "—"} sub={overview && overview.trades24h === 0 ? "24h trades: 0 reported (snapshot may lag)" : "mainnet"} /></div>
      </div>
      <div className="card">
        <div className="row between" style={{ flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
          <Tabs value={network} onChange={setNetwork} options={[{ v: "mainnet", label: "Mainnet · live data" }, { v: "testnet", label: "Testnet · tradeable here" }]} />
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search code, issuer or org…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {network === "mainnet" ? (
          <>
            <div className="notice" data-testid="mainnet-data-notice">
              <b>Market data: Stellar mainnet</b> (public Horizon, read-only). <b>Trading on Quasaria: testnet only</b> — the Trade button opens Quasaria's testnet market for the same asset code (or XLM/USDC), never a mainnet order.
            </div>
            {live.mode === "fallback" && (
              <div className="notice warn" data-testid="fallback-notice">
                <b>Live feed unavailable, showing saved copy.</b> Snapshot from {snapTime(live.snapshotAt)} (stellarchain.io data saved at the last deploy). Retrying Stellar mainnet in the background{retryIn !== null ? ` (next try in ${retryIn}s)` : ""} — the table switches back to live data automatically.
                {live.error ? <span className="muted"> Reason: {live.error}{live.rateLimited ? " (Horizon rate limit — backing off)" : ""}.</span> : null}
              </div>
            )}
            {live.mode === "live" && live.snapshotRows > 0 && (
              <div className="notice warn" data-testid="partial-notice">
                {live.snapshotRows} of {live.rows.length} assets couldn't be loaded live this round; those rows show saved snapshot values (marked <span style={{ color: "var(--amber)" }}>snapshot</span>) and are retried every refresh.
              </div>
            )}
            <Pager where="top" />
            <div className="mk-scroll" id="mk-table">
            <table className="t mk-table">
              <thead>
                <tr><Th k="rank">#</Th><Th k="code">Asset</Th><Th k="price">Price (XLM)</Th><th>≈ USD</th><th>1h</th><Th k="change24h">24h</Th><Th k="change7d">7d</Th><Th k="volume">Vol 24h (XLM)</Th><Th k="trades">Trades</Th><Th k="holders">Trustlines</Th><th>24h trend</th><th>As of</th><th /></tr>
              </thead>
              <tbody>
                {live.mode === "loading" && !allRows.length && <tr><td colSpan={13} className="muted">Loading live Stellar mainnet data…</td></tr>}
                {live.mode !== "loading" && !allRows.length && <tr><td colSpan={13} className="muted">No market data available (live feed and saved snapshot both unavailable).</td></tr>}
                {liveRows.map((r) => {
                  const snapRow = r.source === "snapshot";
                  const snapTip = `saved snapshot (${snapTime(live.snapshotAt)})`;
                  return (
                    <Fragment key={r.key}>
                    <tr data-testid="market-row" data-source={r.source}>
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
                      <td className="mono">
                        {r.priceXlm !== null ? priceFmt(r.priceXlm) : <span className="muted">—</span>}
                        {r.priceKind === "book" && <div className="muted" style={{ fontSize: "0.62rem" }}>order-book mid</div>}
                      </td>
                      <td className="mono">{!snapRow && r.priceXlm !== null && usdPerXlm ? `$${priceFmt(r.priceXlm * usdPerXlm)}` : <span className="muted" title={snapRow ? "not shown for saved-snapshot rows (their XLM prices are from an older time than any XLM/USD rate)" : undefined}>—</span>}</td>
                      <td className="mono">{chg(r.change1h)}</td>
                      <td className="mono">{chg(r.change24h)}</td>
                      <td className="mono">{chg(r.change7d)}</td>
                      <td className="mono">{r.volumeXlm24h !== null ? fmtCompact(r.volumeXlm24h) : "—"}</td>
                      <td className="mono">{r.trades24h !== null ? fmtCompact(r.trades24h) : "—"}</td>
                      <td className="mono">
                        {r.holders !== null ? fmtCompact(r.holders) : "—"}
                        {!snapRow && r.snapshotFields.includes("holders") && r.holders !== null && <SnapMark title={`trustlines from the ${snapTip}; live value loading`} />}
                        {r.supply !== null && <div className="muted" style={{ fontSize: "0.62rem" }} title="circulating supply (Horizon /assets)">supply {fmtCompact(r.supply)}</div>}
                      </td>
                      <td><Sparkline values={r.sparkline} /></td>
                      <td style={{ fontSize: "0.72rem" }} className="muted" title={snapRow ? snapTip : r.lastTradeAt ? (r.lastTradeExact ? `last trade seen on the live feed: ${new Date(r.lastTradeAt).toLocaleString()}` : `last trade in the hourly candle starting ${new Date(r.lastTradeAt).toLocaleString()}`) : undefined}>
                        {snapRow ? <span style={{ color: "var(--amber)" }} data-testid="row-snapshot">snapshot</span> : r.priceKind === "trade" && r.lastTradeAt ? (r.lastTradeExact ? `last trade ${asOf(new Date(r.lastTradeAt).toISOString())}` : r.lastTradeAt + 3600_000 > live.now ? "traded this hour" : `last trade ≈ ${asOf(new Date(r.lastTradeAt + 3600_000).toISOString())}`) : r.priceKind === "book" ? "live book" : "no trades 24h"}
                      </td>
                      <td><div className="mk-acts"><button className="btn small ghost" onClick={() => tradeMainnet(r)} title={`Opens Quasaria's TESTNET market${testnetByCode.has(r.code) || r.code === "USDC" ? ` for ${r.code}` : " (XLM/USDC)"} — mainnet data is reference only`}>Trade</button>
                        <button className={`btn small ghost about-btn ${aboutKey === r.key ? "on" : ""}`} aria-expanded={aboutKey === r.key} onClick={() => setAboutKey((k) => (k === r.key ? null : r.key))}>About</button></div></td>
                    </tr>
                    {aboutKey === r.key && <tr className="about-row"><td colSpan={13}><AssetAbout code={r.code} issuer={r.issuer} homeDomain={r.homeDomain} snapshotDesc={(full?.raw.get(r.key)?.tomlInfo as { desc?: string } | undefined)?.desc ?? null} onClose={() => setAboutKey(null)} /></td></tr>}
                    </Fragment>
                  );
                })}
                {allRows.length > 0 && !liveRows.length && <tr><td colSpan={13} className="muted">No assets in the top {allRows.length.toLocaleString()} match.</td></tr>}
              </tbody>
            </table>
            </div>
            <Pager where="bottom" />
            {q.length >= 2 && (
              <div className="mk-beyond" data-testid="beyond">
                <h3>Beyond the top {allRows.length.toLocaleString()}: any Stellar asset</h3>
                <p className="muted" style={{ fontSize: "0.75rem", marginTop: 0 }}>Searched live on stellar.expert (code, name, domain) and Horizon (exact code or G… issuer). Not ranked by Quasaria; anyone can issue an asset with any code, so check the issuer.</p>
                {beyond.loading && <p className="muted">Searching the whole Stellar network…</p>}
                {!beyond.loading && !beyond.hits.length && <p className="muted">No other assets found for "{q}".</p>}
                <ul className="mk-beyond-list">
                  {beyond.hits.map((h) => (
                    <li key={h.key}>
                      <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span><b>{h.code}</b> <span className="muted mono" style={{ fontSize: "0.72rem" }}>{h.issuer.slice(0, 6)}…{h.issuer.slice(-6)}</span>{h.homeDomain && <span className="muted"> · {h.homeDomain}</span>}{h.holders !== null && <span className="muted"> · {fmtCompact(h.holders)} trustlines</span>}</span>
                        <button className={`btn small ghost about-btn ${aboutKey === h.key ? "on" : ""}`} aria-expanded={aboutKey === h.key} onClick={() => setAboutKey((k) => (k === h.key ? null : h.key))}>About</button>
                      </div>
                      {aboutKey === h.key && <AssetAbout code={h.code} issuer={h.issuer} homeDomain={h.homeDomain} onClose={() => setAboutKey(null)} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="muted" style={{ fontSize: "0.75rem", marginTop: 10 }}>
              Live data: Stellar <b>mainnet</b> public Horizon (<a href="https://horizon.stellar.org" target="_blank" rel="noreferrer">horizon.stellar.org</a>), refreshed every ~{REFRESH_MS / 1000}s while this tab is visible (paused when hidden). Price = last trade vs XLM (order-book mid when there was no trade in 24h); live price from the network-wide trade feed (polled every ~30s); 1h / 24h / 7d change, 24h volume, trades and the 24h trend from Horizon hourly trade aggregations (refreshed every ~10 min per asset to respect Horizon's rate limits); trustlines (authorized holders) and supply from Horizon /assets; USD via the XLM/USDC pair (Circle issuer {MAINNET_USDC_ISSUER.slice(0, 4)}…{MAINNET_USDC_ISSUER.slice(-4)}). The asset list (top {allRows.length.toLocaleString()}: stellarchain.io rank{full?.sources?.stellarExpert ? `, topped up with ${full.sources.stellarExpert} from stellar.expert's rating` : ""}), rank, logos and org names (from issuers' stellar.toml) come from the list saved at every deploy and 30-minute refresh{full?.at ? ` (${snapTime(full.at)})` : ""}; the top {LIVE_N} update live from Horizon and the rest show the saved values (marked snapshot). If Horizon can't be reached, the saved snapshot is shown and labelled with its time. Mainnet rows are reference-only — Quasaria trades on TESTNET. Listing ≠ endorsement: always verify the issuer.
            </p>
          </>
        ) : (
          <>
            {data?.source === "snapshot" && <div className="notice" data-testid="snapshot-notice">The live stellarchain.io API isn't reachable from this site, so this table shows the {snapshotLabel(data.snapshotAt)} ({asOf(data.snapshotAt ?? "")}), fetched when the site was last deployed. Testnet prices are still refreshed from Horizon where possible.</div>}
            {data?.error && <div className="notice warn">stellarchain.io unavailable ({data.error}). Showing nothing until it recovers; the Trade page keeps working from Horizon.</div>}
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
                    <td className="mono"><span className="muted">—</span></td>
                    <td className="mono">{chg(r.change1h)}</td>
                    <td className="mono">{chg(r.change24h)}</td>
                    <td className="mono">{chg(r.change7d)}</td>
                    <td className="mono">{r.volumeXlm24h !== null ? fmtCompact(r.volumeXlm24h) : "—"}</td>
                    <td className="mono">{r.trades24h !== null ? fmtCompact(r.trades24h) : "—"}</td>
                    <td className="mono">{r.trustlines !== null ? fmtCompact(r.trustlines) : "—"}</td>
                    <td><Sparkline values={r.sparkline} /></td>
                    <td style={{ fontSize: "0.72rem" }} className={r.stale ? "neg" : "muted"} title={r.priceAsOf ?? r.updatedAt}>{asOf(r.priceAsOf ?? r.updatedAt)}{r.stale ? " · stale" : ""}</td>
                    <td><button className="btn small ghost" onClick={() => trade(r)}>Trade</button></td>
                  </tr>
                ))}
                {data && !data.rows.length && !data.error && <tr><td colSpan={13} className="muted">No assets match.</td></tr>}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: "0.75rem", marginTop: 10 }}>
              Ranking, logos, org names and stats: <a href="https://stellarchain.io" target="_blank" rel="noreferrer">stellarchain.io</a> public API (cached 5 min; falls back to a build-time snapshot, labelled with its time, when the API can't be reached from the browser). Snapshots older than 24h are flagged <span className="neg">stale</span>; missing/stale prices fall back to the Horizon order book vs XLM. Testnet prices come from sparse testnet order books and are not real market prices (so no USD conversion is shown). Quasaria trades on TESTNET. Listing ≠ endorsement: always verify the issuer.
            </p>
          </>
        )}
      </div>
    </>
  );
}
