import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead, Tabs, TxStatus, useTx } from "../components/ui";
import { AssetLogo } from "../components/AssetBits";
import { useWallet } from "../lib/wallet";
import { useXlmUsd } from "../lib/markets";
import { useAsync } from "../lib/useAsync";
import { fmt, fmtCompact } from "../lib/format";
import {
  BASE_RESERVE, MAINNET_BROWSE, buildDepositTx, buildWithdrawTx, curatedList, deriveXlmUsd, depositReserveCost, feeApr, fetchAccountBalances, fetchAssetBalance,
  fetchPoolForPair, fetchPositions, loadCuratedPools, fetchRecentPools, fetchVolume24h, keyOf, orderAssets, poolIdFor, poolVerified, pooled, previewDeposit, previewWithdraw, spot, tvlUsd,
  verifyAsset, volumeUnit, type AssetRef, type NetId, type PoolRow, type Pricing,
} from "../lib/nativePools";
import { submitSignedXdr } from "../lib/stellar";
import { REWARD_ASSET_CODE } from "../lib/rewards";

const logoOf = (net: NetId, a: AssetRef) => curatedList(net).find((c) => c.code === a.code && c.issuer === a.issuer)?.logo ?? null;
function AssetChip({ net, a, size = 20 }: { net: NetId; a: AssetRef; size?: number }) {
  const v = verifyAsset(net, a);
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex" }}>
      <AssetLogo code={a.code} issuer={a.issuer} logo={logoOf(net, a)} size={size} />
      <b>{a.code}</b>
      {v.status === "unverified" && <span className="pill pink" style={{ fontSize: "0.55rem" }} title="Not on the issuer-verified list">unverified</span>}
      {v.status === "lookalike" && <span className="pill pink" style={{ fontSize: "0.55rem" }} title="Same ticker as a verified asset, different issuer">look-alike</span>}
    </span>
  );
}

const usd = (n: number | null) => (n == null ? "—" : `$${fmtCompact(n)}`);
const amt = (n: number) => (n >= 1000 ? fmtCompact(n) : fmt(n, n < 1 ? 6 : 3));

type Row = PoolRow & { volume?: number | null; truncated?: boolean };

export default function Pools() {
  const w = useWallet();
  const [net, setNet] = useState<NetId>("testnet");
  const [scope, setScope] = useState<"curated" | "recent">("curated");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [vol, setVol] = useState<Record<string, { volume: number; truncated: boolean }>>({});
  const refXlm = useXlmUsd();
  const list = useAsync(() => (scope === "curated" ? loadCuratedPools(net) : fetchRecentPools(net, 40)), [net, scope]);
  const pools = list.data ?? [];
  const pricing: Pricing = useMemo(() => ({ xlmUsd: deriveXlmUsd(net, pools) ?? (net === "mainnet" ? refXlm?.price ?? null : null) ?? refXlm?.price ?? null }), [pools, net, refXlm?.price]);
  const rows: Row[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    return pools
      .filter((p) => !t || `${p.a.code}/${p.b.code}`.toLowerCase().includes(t) || (p.a.issuer ?? "").toLowerCase().includes(t) || (p.b.issuer ?? "").toLowerCase().includes(t) || p.id.startsWith(t))
      .map((p) => ({ ...p, volume: vol[p.id]?.volume ?? null, truncated: vol[p.id]?.truncated }))
      .sort((x, y) => (tvlUsd(y, pricing) ?? 0) - (tvlUsd(x, pricing) ?? 0) || y.reserveA - x.reserveA);
  }, [pools, q, vol, pricing]);

  // 24h volume for the top pools only (rate-limit friendly: bounded concurrency, top 12)
  useEffect(() => {
    let alive = true;
    const top = [...pools].sort((x, y) => (tvlUsd(y, pricing) ?? 0) - (tvlUsd(x, pricing) ?? 0)).slice(0, 12).filter((p) => !(p.id in vol));
    pooled(top, 3, async (p) => ({ p, v: await fetchVolume24h(net, p.id, volumeUnit(p, pricing).unit) }), ({ p, v }) => { if (alive) setVol((m) => ({ ...m, [p.id]: { volume: v.volume, truncated: v.truncated } })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools.length, net]);

  const positions = useAsync(() => (w.address ? fetchPositions(net, w.address, pricing) : Promise.resolve([])), [w.address, net, pools.length]);
  const selected = pools.find((p) => p.id === sel) ?? null;

  return (
    <>
      <PageHead kicker="Pools" title="Liquidity pools" right={<span className="pill gold">{net === "testnet" ? "Testnet · unaudited" : "Mainnet · read-only"}</span>}>
        Stellar's native liquidity pools: add both sides of a pair and earn a share of the 0.30% fee on every swap. Impermanent loss can outweigh fees.
      </PageHead>
      <div className="notice" role="note" style={{ marginBottom: 12, fontSize: "0.82rem" }}><b>Plainly:</b> a pool is a protocol feature of Stellar, not a Quasaria contract. Your share is a pool-share trustline on your own account. Fees accrue inside the pool and are paid out when you withdraw. Past volume does not predict future fees, and the fee APR shown is an estimate that ignores impermanent loss.</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Tabs value={scope} onChange={(v) => { setScope(v); setSel(null); }} options={[{ v: "curated", label: "Verified pairs" }, { v: "recent", label: "Recent pools (any asset)" }]} />
          {MAINNET_BROWSE && <Tabs value={net} onChange={(v) => { setNet(v); setSel(null); setVol({}); }} options={[{ v: "testnet", label: "Testnet" }, { v: "mainnet", label: "Mainnet (read-only)" }]} />}
          <input className="input" style={{ maxWidth: 260 }} placeholder="Search code, issuer or pool id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pools" data-testid="pool-search" />
          <button className="btn small ghost" onClick={() => { setVol({}); list.reload(); }}>Refresh</button>
        </div>
        {scope === "recent" && <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 0 }}>Anyone can create a pool for any two assets, so recent pools are shown with a verification flag. Only pools where both assets are on Quasaria's issuer-verified list are marked verified.</p>}
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="t" data-testid="pool-table">
            <thead><tr><th>Pair</th><th>TVL</th><th>24h volume</th><th>Fee APR (est.)</th><th>Reserves</th><th>Providers</th><th /></tr></thead>
            <tbody>
              {list.loading && <tr><td colSpan={7} className="muted">Reading Horizon…</td></tr>}
              {list.error && <tr><td colSpan={7} className="neg">Could not read pools: {list.error}</td></tr>}
              {!list.loading && !list.error && !rows.length && <tr><td colSpan={7} className="muted" data-testid="no-pools">{scope === "curated" ? "No pools exist yet for the verified pairs on this network. Pick a pair below and make the first deposit to create one." : "No pools match."}</td></tr>}
              {rows.map((p) => {
                const t = tvlUsd(p, pricing), vu = volumeUnit(p, pricing);
                const vUsd = p.volume != null && vu.usd != null ? p.volume * vu.usd : null;
                return (
                  <tr key={p.id} className={sel === p.id ? "l-sel" : ""} onClick={() => setSel(p.id)} style={{ cursor: "pointer" }} data-testid="pool-row">
                    <td><AssetChip net={net} a={p.a} /> <span className="muted">/</span> <AssetChip net={net} a={p.b} /> {poolVerified(net, p) ? <span className="pill green" style={{ fontSize: "0.55rem" }}>✔ verified</span> : null}</td>
                    <td className="mono">{usd(t)}</td>
                    <td className="mono">{p.volume == null ? "…" : vUsd != null ? `${usd(vUsd)}${p.truncated ? "+" : ""}` : `${amt(p.volume)} ${vu.unit.code}`}</td>
                    <td className="mono">{(() => { const a = feeApr(vUsd, t); return a == null ? "—" : `${fmt(a, 2)}%`; })()}</td>
                    <td className="mono muted" style={{ fontSize: "0.72rem" }}>{amt(p.reserveA)} {p.a.code} / {amt(p.reserveB)} {p.b.code}</td>
                    <td className="mono">{p.holders}</td>
                    <td><button className="btn small ghost">Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <PairPicker net={net} pools={pools} onPick={(id) => setSel(id)} />

      {(selected || sel?.startsWith("new:")) && <PoolPanel key={sel!} net={net} sel={sel!} pool={selected} pricing={pricing} onDone={() => { list.reload(); positions.reload(); }} />}

      <div className="card" style={{ marginTop: 16 }} data-testid="my-positions">
        <h2 style={{ marginTop: 0 }}>Your positions</h2>
        {!w.address ? <p className="muted">Create a keypair or sign in with your secret key to see your pool shares. <button className="btn small" onClick={() => w.openModal()}>Sign in</button></p>
          : positions.loading ? <p className="muted">Reading Horizon…</p>
          : !positions.data?.length ? <p className="muted">No pool shares on this account yet.</p>
          : (
            <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Pair</th><th>Shares</th><th>Pool share</th><th>Your amounts</th><th>Value</th><th /></tr></thead><tbody>
              {positions.data.map((p) => (
                <tr key={p.pool.id}>
                  <td><AssetChip net={net} a={p.pool.a} /> / <AssetChip net={net} a={p.pool.b} /></td>
                  <td className="mono">{fmt(p.shares, 4)}</td>
                  <td className="mono">{fmt(p.fraction * 100, 4)}%</td>
                  <td className="mono">{amt(p.amountA)} {p.pool.a.code} + {amt(p.amountB)} {p.pool.b.code}</td>
                  <td className="mono">{usd(p.usd)}</td>
                  <td><button className="btn small ghost" onClick={() => { setSel(p.pool.id); if (!pools.some((x) => x.id === p.pool.id)) { /* show anyway */ } }}>Manage</button></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 0 }}>Earned fees stay in the pool and raise what your shares are worth. See the <Link to="/earn">Earnings</Link> tab for fee earnings and {REWARD_ASSET_CODE} holder rewards.</p>
      </div>
    </>
  );
}

/** Choose any two curated assets; if the pool does not exist the first deposit creates it. */
function PairPicker({ net, pools, onPick }: { net: NetId; pools: PoolRow[]; onPick: (sel: string) => void }) {
  const list = curatedList(net);
  const [a, setA] = useState(0), [b, setB] = useState(Math.min(1, list.length - 1));
  const A = list[a], B = list[b];
  const same = a === b;
  const id = !same && A && B ? poolIdFor(A, B) : null;
  return (
    <div className="card" style={{ marginBottom: 16 }} data-testid="pair-picker">
      <h2 style={{ marginTop: 0 }}>Pick a pair</h2>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <select className="input" style={{ maxWidth: 220 }} value={a} onChange={(e) => setA(Number(e.target.value))} aria-label="Asset 1">{list.map((c, i) => <option key={keyOf(c)} value={i}>{c.code}{c.issuer ? ` · ${c.issuer.slice(0, 4)}…${c.issuer.slice(-4)}` : ""}</option>)}</select>
        <span className="muted">+</span>
        <select className="input" style={{ maxWidth: 220 }} value={b} onChange={(e) => setB(Number(e.target.value))} aria-label="Asset 2">{list.map((c, i) => <option key={keyOf(c)} value={i}>{c.code}{c.issuer ? ` · ${c.issuer.slice(0, 4)}…${c.issuer.slice(-4)}` : ""}</option>)}</select>
        <button className="btn small" disabled={same || !id} onClick={() => id && onPick(pools.some((p) => p.id === id) ? id : `new:${id}:${keyOf(orderAssets(A, B)[0])}|${keyOf(orderAssets(A, B)[1])}`)}>Open</button>
      </div>
      <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 0 }}>Assets come from the issuer-verified list and are matched by code and issuer, never by ticker alone. {same ? "Pick two different assets." : id && !pools.some((p) => p.id === id) ? "No pool is loaded for this pair yet: depositing creates it (or joins it if it exists but is not in the list)." : ""}</p>
    </div>
  );
}

function PoolPanel({ net, sel, pool: poolIn, pricing, onDone }: { net: NetId; sel: string; pool: PoolRow | null; pricing: Pricing; onDone: () => void }) {
  const w = useWallet();
  const tx = useTx();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  // a "new:" selection is a pair with no loaded pool: look it up, else it is created by the deposit
  const pair = useMemo(() => {
    if (poolIn) return { a: poolIn.a, b: poolIn.b };
    const [, , k] = sel.split(":");
    const [ka, kb] = (k ?? "|").split("|");
    const f = (s: string): AssetRef => (s === "native" ? { code: "XLM", issuer: null } : { code: s.split(":")[0], issuer: s.split(":")[1] });
    return { a: f(ka), b: f(kb) };
  }, [poolIn, sel]);
  const looked = useAsync(() => (poolIn ? Promise.resolve(poolIn) : fetchPoolForPair(net, pair.a, pair.b)), [sel]);
  const pool: PoolRow | null = poolIn ?? looked.data;
  const [driver, setDriver] = useState<"A" | "B">("A");
  const [amount, setAmount] = useState("100");
  const [other, setOther] = useState("100");
  const [slip, setSlip] = useState(100); // bps
  const [pct, setPct] = useState(100);
  const [closeTl, setCloseTl] = useState(true);
  const [ack, setAck] = useState(false);
  const bal = useAsync(async () => {
    if (!w.address) return null;
    const [ba, bb, acct] = await Promise.all([fetchAssetBalance(net, w.address, pair.a), fetchAssetBalance(net, w.address, pair.b), fetchAccountBalances(net, w.address)]);
    return { a: ba, b: bb, acct };
  }, [w.address, net, sel, tx.status]);

  const verified = poolVerified(net, pair);
  const poolId = poolIdFor(pair.a, pair.b);
  const pv = previewDeposit({ pool, driver, amount: Number(amount), otherAmount: Number(other), slippageBps: slip });
  const shareBal = useAsync(async () => {
    if (!w.address) return 0;
    const ps = await fetchPositions(net, w.address, pricing);
    return ps.find((p) => p.pool.id === poolId)?.shares ?? 0;
  }, [w.address, poolId, tx.status]);
  const mine = shareBal.data ?? 0;
  const wd = pool && mine > 0 ? previewWithdraw(pool, (mine * pct) / 100, slip) : null;
  const acct = bal.data?.acct;
  const cost = depositReserveCost({ needTrustA: !!pair.a.issuer && !acct?.trust.has(keyOf(pair.a)), needTrustB: !!pair.b.issuer && !acct?.trust.has(keyOf(pair.b)), needShareTrust: !acct?.shareTrust.has(poolId) });
  const needMore = pv && ((bal.data?.a ?? 0) < pv.maxAmountA || (bal.data?.b ?? 0) < pv.maxAmountB);
  const blocked = !verified && !ack;
  const spotTxt = pool ? `1 ${pool.a.code} = ${fmt(spot(pool), 6)} ${pool.b.code}` : null;

  return (
    <div className="card glow" style={{ marginBottom: 16 }} data-testid="pool-panel">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}><AssetChip net={net} a={pair.a} size={24} /> / <AssetChip net={net} a={pair.b} size={24} /></h2>
        <span className={`pill ${verified ? "green" : "pink"}`}>{verified ? "✔ both assets verified" : "contains an unverified asset"}</span>
      </div>
      <p className="muted mono" style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>Pool id {poolId}</p>
      {!pool && !looked.loading && <div className="notice">No pool exists for this pair yet. Your first deposit creates it and sets its starting price from the two amounts you enter, so enter the market ratio: anyone can trade against a mispriced pool.</div>}
      {pool && <div className="l-est"><div><span className="muted l-tiny">Reserves</span><b className="mono">{amt(pool.reserveA)} {pool.a.code} / {amt(pool.reserveB)} {pool.b.code}</b></div><div><span className="muted l-tiny">Spot price</span><b className="mono">{spotTxt}</b></div><div><span className="muted l-tiny">Fee</span><b className="mono">0.30%</b></div><div><span className="muted l-tiny">Total shares</span><b className="mono">{amt(pool.totalShares)}</b></div></div>}
      {!verified && <label className="row" style={{ gap: 8, margin: "8px 0", fontSize: "0.85rem" }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="unverified-ack" /> I checked the issuers myself and accept the risk of an unverified asset.</label>}
      <Tabs value={mode} onChange={setMode} options={[{ v: "deposit", label: "Deposit" }, { v: "withdraw", label: "Withdraw" }]} />
      <div className="field" style={{ marginTop: 10 }}>
        <label>Max slippage: {fmt(slip / 100, 2)}%</label>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {[50, 100, 200].map((s) => <button key={s} className={`chip ${slip === s ? "on" : ""}`} onClick={() => setSlip(s)}>{s / 100}%</button>)}
          <input className="input" style={{ maxWidth: 110 }} type="number" min={0.01} max={50} step={0.1} value={slip / 100} onChange={(e) => setSlip(Math.round(Math.min(Math.max(Number(e.target.value) || 0.01, 0.01), 50) * 100))} aria-label="Slippage percent" data-testid="slippage-input" />
        </div>
        <p className="muted" style={{ fontSize: "0.74rem", margin: "4px 0 0" }}>{mode === "deposit" ? "The deposit fails instead of executing outside the price range ±slippage around the price you saw." : "The withdrawal fails if you would receive less than the minimum amounts shown."}</p>
      </div>

      {mode === "deposit" ? (
        <>
          <div className="grid g-2">
            <div className="field"><label>{pair.a.code} {bal.data?.a != null && <span className="muted">· balance {fmt(bal.data.a, 4)}</span>}</label>
              <input className="input" inputMode="decimal" value={driver === "A" ? amount : pv ? String(Number(pv.amountA.toFixed(7))) : ""} onChange={(e) => { setDriver("A"); setAmount(e.target.value); }} data-testid="dep-a" /></div>
            <div className="field"><label>{pair.b.code} {bal.data?.b != null && <span className="muted">· balance {fmt(bal.data.b, 4)}</span>}</label>
              <input className="input" inputMode="decimal" value={pool ? (driver === "B" ? amount : pv ? String(Number(pv.amountB.toFixed(7))) : "") : other} onChange={(e) => { if (pool) { setDriver("B"); setAmount(e.target.value); } else setOther(e.target.value); }} data-testid="dep-b" /></div>
          </div>
          {pv && (
            <div className="l-est" data-testid="dep-preview">
              <div><span className="muted l-tiny">You get (est.)</span><b className="mono">{fmt(pv.shares, 4)} shares</b></div>
              <div><span className="muted l-tiny">Pool share after</span><b className="mono">{fmt(pv.poolShareAfter * 100, 4)}%</b></div>
              <div><span className="muted l-tiny">Price range accepted</span><b className="mono">{fmt(pv.minPrice, 6)} to {fmt(pv.maxPrice, 6)} {pair.a.code}/{pair.b.code}</b></div>
              <div><span className="muted l-tiny">New reserve locked</span><b className="mono">{fmt(cost.total, 1)} XLM</b></div>
            </div>
          )}
          {cost.total > 0 && <p className="muted" style={{ fontSize: "0.76rem" }}>This also adds {[cost.trustlines > 0 ? "missing asset trustlines" : "", cost.shareTrust > 0 ? "the pool-share trustline (counts as 2 entries)" : ""].filter(Boolean).join(" and ")}, locking {fmt(cost.total, 1)} XLM of reserve (0.5 XLM per entry) while you hold them. Keep {fmt(BASE_RESERVE, 1)} XLM or more spare for fees.</p>}
          {needMore && w.address && <div className="notice warn" style={{ fontSize: "0.8rem" }}>Your balance looks too low for this deposit.</div>}
          {!w.address ? <button className="btn block" onClick={() => w.openModal()}>Sign in to deposit</button> : (
            <button className="btn block" data-testid="deposit-btn" disabled={tx.busy || !pv || blocked || !!needMore} onClick={() => tx.run("deposit", async () => {
              const r = await buildDepositTx(net, w.address!, pair.a, pair.b, pv!);
              const res = await submitSignedXdr(await w.sign(r.xdr));
              onDone();
              return res.hash;
            })}>{pool ? "Deposit" : "Create pool & deposit"}</button>
          )}
        </>
      ) : (
        <>
          {!w.address ? <button className="btn block" onClick={() => w.openModal()}>Sign in to withdraw</button> : mine <= 0 ? <p className="muted">You hold no shares of this pool.</p> : (
            <>
              <div className="field"><label>Withdraw {pct}% of your {fmt(mine, 4)} shares</label><input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} data-testid="wd-pct" /></div>
              {wd && (
                <div className="l-est" data-testid="wd-preview">
                  <div><span className="muted l-tiny">You receive (est.)</span><b className="mono">{amt(wd.amountA)} {pair.a.code} + {amt(wd.amountB)} {pair.b.code}</b></div>
                  <div><span className="muted l-tiny">Minimum accepted</span><b className="mono">{amt(wd.minAmountA)} {pair.a.code} + {amt(wd.minAmountB)} {pair.b.code}</b></div>
                </div>
              )}
              {pct === 100 && <label className="row" style={{ gap: 8, fontSize: "0.85rem" }}><input type="checkbox" checked={closeTl} onChange={(e) => setCloseTl(e.target.checked)} /> Also close the pool-share trustline (frees its 1 XLM reserve)</label>}
              <button className="btn block" data-testid="withdraw-btn" disabled={tx.busy || !wd || !pool} style={{ marginTop: 8 }} onClick={() => tx.run("withdraw", async () => {
                const xdr = await buildWithdrawTx(net, w.address!, pool!, wd!, pct === 100 && closeTl);
                const res = await submitSignedXdr(await w.sign(xdr));
                onDone();
                return res.hash;
              })}>Withdraw</button>
            </>
          )}
        </>
      )}
      <TxStatus status={tx.status} />
      {tx.status && /: confirmed \((\w+)\)/.test(tx.status) && <p className="muted" style={{ fontSize: "0.76rem" }}>Find it in your <Link to="/activity">Activity</Link> tab.</p>}
    </div>
  );
}
