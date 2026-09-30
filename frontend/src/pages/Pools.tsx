import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead, SourceTag, Stat, Tabs, TxStatus, ViewerNote, useTx } from "../components/ui";
import { DEMO_POOLS } from "../lib/demo";
import { CONTRACTS, expertContract, symbolOf } from "../lib/config";
import { addr, i128, invokeContract } from "../lib/soroban";
import { poolVolumes, readPool, tokenBalance, useChain, useViewer, type PoolInfo } from "../lib/chain";
import { fmt, fmtCompact, toUnits } from "../lib/format";
import { Asset } from "@stellar/stellar-sdk";
import { buildNativeLpDeposit, buildTrustline, fetchBalances, fetchNativePool, hasTrustline, nativePoolId, submitSignedXdr, type Balance } from "../lib/stellar";
import AssetSelect, { AssetBadge } from "../components/AssetSelect";
import { AssetLogo } from "../components/AssetBits";
import { ASSET_LIST, POOL_LIST, RETIRED_NOTE, RETIRED_POOLS, assetById, findPool, ilRisk, mainnetUrl, poolsWith, type ListedAsset, type ListedPool } from "../lib/assets";

type PoolView = (typeof DEMO_POOLS)[number] & { volumeLive?: boolean; tokenA?: string; tokenB?: string };

const classicOf = (a: ListedAsset | undefined) => (!a || a.testnet.kind === "native" || !a.testnet.issuer ? null : new Asset(a.testnet.code, a.testnet.issuer));

/** Read many pools with bounded concurrency (RPC friendliness). */
async function readPools(ids: string[], conc = 6): Promise<Record<string, PoolInfo>> {
  const out: Record<string, PoolInfo> = {};
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try { out[id] = await readPool(id); } catch { /* leave missing */ }
    }
  }));
  return out;
}

export default function Pools() {
  const viewer = useViewer("lp");
  const [selId, setSelId] = useState<string | null>(null);
  const [sideA, setSideA] = useState<ListedAsset | undefined>(() => assetById("USDC"));
  const [sideB, setSideB] = useState<ListedAsset | undefined>(() => assetById("XLM"));
  const [mode, setMode] = useState<"deposit" | "withdraw" | "native">("deposit");
  const [amtA, setAmtA] = useState("100");
  const [shares, setShares] = useState("10");
  const [slippage, setSlippage] = useState(0.5);
  const [cat, setCat] = useState<"all" | "stablecoin" | "popular">("all");
  const [showRetired, setShowRetired] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tx = useTx();

  // core (QUSD/QFX) pools
  const chain = useChain(async () => {
    const infos = await Promise.all(CONTRACTS.pools.map(readPool));
    const [mine, vols] = await Promise.all([
      Promise.all(infos.map((p) => (viewer.address ? tokenBalance(p.id, viewer.address) : Promise.resolve(0)))),
      poolVolumes(infos).catch(() => null),
    ]);
    return infos.map<PoolView>((p, i) => ({
      id: p.id, a: symbolOf(p.tokenA), b: symbolOf(p.tokenB), reserveA: p.reserveA, reserveB: p.reserveB, totalShares: p.totalShares, feeBps: p.feeBps,
      volume24h: vols ? vols[p.id] : 0, volumeLive: Boolean(vols), myShares: mine[i], tokenA: p.tokenA, tokenB: p.tokenB,
    }));
  }, [viewer.address, nonce]);
  const core: PoolView[] = chain.data ?? DEMO_POOLS;

  // v3 asset pools (live reserves; falls back to the seeded amounts)
  const assetLive = useChain(() => readPools(POOL_LIST.map((p) => p.pool!)), [nonce]);
  const assetView = (lp: ListedPool): PoolView => {
    const l = assetLive.data?.[lp.pool!];
    return { id: lp.pool!, a: assetById(lp.assetA)?.code ?? lp.assetA, b: assetById(lp.assetB)?.code ?? lp.assetB, reserveA: l?.reserveA ?? lp.seeded!.a, reserveB: l?.reserveB ?? lp.seeded!.b, totalShares: l?.totalShares ?? Math.sqrt(lp.seeded!.a * lp.seeded!.b), feeBps: l?.feeBps ?? lp.feeBps, volume24h: 0, myShares: 0, tokenA: lp.tokenA, tokenB: lp.tokenB };
  };

  // picker → pool
  const picked = sideA && sideB ? findPool(sideA.id, sideB.id) : undefined;
  useEffect(() => {
    if (picked) setSelId(picked.pool!);
  }, [picked?.pool]); // eslint-disable-line react-hooks/exhaustive-deps

  const selAsset = POOL_LIST.find((p) => p.pool === selId);
  const selCore = core.find((p) => p.id === selId) ?? (selAsset ? undefined : core[0]);
  // live read of the selected asset pool + the viewer's LP balance
  const selLive = useChain(async () => {
    if (!selAsset) return null;
    const [info, mine] = await Promise.all([readPool(selAsset.pool!), viewer.address ? tokenBalance(selAsset.pool!, viewer.address).catch(() => 0) : Promise.resolve(0)]);
    return { info, mine };
  }, [selAsset?.pool, viewer.address, nonce]);
  const p: PoolView = selAsset
    ? { ...assetView(selAsset), ...(selLive.data ? { reserveA: selLive.data.info.reserveA, reserveB: selLive.data.info.reserveB, totalShares: selLive.data.info.totalShares, feeBps: selLive.data.info.feeBps, myShares: selLive.data.mine } : {}) }
    : selCore!;
  const A = selAsset ? assetById(selAsset.assetA) : undefined;
  const B = selAsset ? assetById(selAsset.assetB) : undefined;
  const live = selAsset ? selLive.live : chain.live;

  // wallet balances → trustline hints for classic assets
  const [balances, setBalances] = useState<Balance[] | null>(null);
  useEffect(() => {
    if (!tx.wallet.address) return setBalances(null);
    fetchBalances(tx.wallet.address).then(setBalances).catch(() => setBalances(null));
  }, [tx.wallet.address, nonce]);
  const missingTrust = [A, B].filter((x) => { const c = classicOf(x); return c && balances && !hasTrustline(balances, c); }) as ListedAsset[];

  // native (CAP-38) pool for XLM/classic pairs
  const nativeAsset = selAsset && selAsset.assetA === "XLM" ? classicOf(B) : null;
  const native = useChain(async () => (nativeAsset ? fetchNativePool(nativePoolId(Asset.native(), nativeAsset)) : null), [nativeAsset?.getCode(), nativeAsset?.getIssuer(), nonce]);
  useEffect(() => {
    if (mode === "native" && !nativeAsset) setMode("deposit");
  }, [nativeAsset, mode]);

  // F-10: real minimums from the live reserves and the user's slippage tolerance (never 0).
  const ratio = p.reserveA > 0 ? p.reserveB / p.reserveA : 0;
  const amtB = Number(amtA) * ratio;
  const slip = slippage / 100;
  const newShares = p.totalShares ? (Number(amtA) / p.reserveA) * p.totalShares : Math.sqrt(Number(amtA) * amtB);
  const outA = p.totalShares ? (Number(shares) / p.totalShares) * p.reserveA : 0;
  const outB = p.totalShares ? (Number(shares) / p.totalShares) * p.reserveB : 0;
  const minUnits = (x: number) => { const u = toUnits(x * (1 - slip)); return u > 0n ? u : 1n; };
  const nativeRatio = native.data && native.data.reserveA > 0 ? native.data.reserveB / native.data.reserveA : (B?.pricePerXlm ?? 0);
  const risk = selAsset ? ilRisk(A, B) : "high";

  const tvl = (x: PoolView) => x.reserveB * 2; // quote-denominated
  const feeApr = (x: PoolView) => (tvl(x) ? ((x.volume24h * x.feeBps * 0.8) / 10_000 / tvl(x)) * 365 * 100 : 0);
  const after = (r: string) => {
    setNonce((n) => n + 1);
    return r;
  };
  const pickPool = (lp: ListedPool) => {
    setSideA(assetById(lp.base));
    setSideB(assetById(lp.quote));
    setSelId(lp.pool!);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const visiblePools = useMemo(() => POOL_LIST.filter((lp) => cat === "all" || assetById(lp.base)?.category === cat), [cat]);
  const seen = new Set<string>();
  const altPools = sideA && !picked ? poolsWith(sideA.id).filter((x) => (seen.has(x.pool!) ? false : (seen.add(x.pool!), true))).slice(0, 6) : [];

  return (
    <>
      <PageHead kicker="Scene · Nebula Drift" title="Liquidity Pools" right={<div className="row"><SourceTag {...chain} /><span className="pill pink">Constant product · SEP-41 LP shares</span><Link className="pill cyan" to="/calculators?c=lp">🧮 LP calculator</Link></div>}>
        Deposit both assets into an x·y=k pool, receive QLP share tokens, and earn 80% of the 0.30% swap fee (20% goes to the trader's referrer, if any). Pick any pair from {ASSET_LIST.length} assets — all notable Stellar stablecoins plus popular assets like SHX, AQUA and yXLM — to build your self-banking setup.
      </PageHead>

      <div className="card" style={{ marginBottom: 18, position: "relative", zIndex: 20 }} data-testid="pool-picker">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Choose a pair</h2>
          <span className="muted" style={{ fontSize: "0.75rem" }}>{POOL_LIST.length} v3 pools · hardened contracts (pause, timelock, two-step admin) · testnet only</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 12, alignItems: "start", marginTop: 12 }}>
          <AssetSelect label="Asset A" value={sideA} exclude={sideB?.id} onChange={setSideA} testId="pick-a" />
          <button type="button" className="btn small ghost" style={{ marginTop: 22 }} aria-label="Swap sides" onClick={() => { setSideA(sideB); setSideB(sideA); }}>⇄</button>
          <AssetSelect label="Asset B" value={sideB} exclude={sideA?.id} onChange={setSideB} testId="pick-b" />
        </div>
        <div style={{ marginTop: 10, fontSize: "0.82rem" }} data-testid="pick-status">
          {picked ? (
            <span className="pos">✔ Pool {picked.pair} exists (<a className="mono" href={expertContract(picked.pool!)} target="_blank" rel="noreferrer">{picked.pool!.slice(0, 6)}…{picked.pool!.slice(-4)}</a>) — selected below. You can supply liquidity now.</span>
          ) : sideA && sideB ? (
            <span className="muted">No {sideA.code}/{sideB.code} pool yet. {altPools.length ? <>Pools with {sideA.code}: {altPools.map((x) => <button key={x.pool} type="button" className="btn small ghost" style={{ margin: "2px 4px" }} onClick={() => pickPool(x)}>{x.pair}</button>)}</> : null} Swaps between them still route through the router via XLM/USDC on the Trade page.</span>
          ) : <span className="muted">Pick both sides.</span>}
        </div>
      </div>

      <div className="grid g-main-side">
        <div className="card">
          <h2>Core pools</h2>
          <table className="t">
            <thead><tr><th>Pool</th><th>Reserves</th><th>TVL (quote)</th><th>24h volume</th><th>Fee APR*</th><th /></tr></thead>
            <tbody>
              {core.map((x) => (
                <tr key={x.id} onClick={() => setSelId(x.id)} style={{ cursor: "pointer", outline: x.id === p.id ? "1px solid var(--quasar)" : undefined }}>
                  <td><b>{x.a}</b><span className="muted"> / {x.b}</span>{chain.live && <div><a className="mono muted" style={{ fontSize: "0.7rem" }} href={expertContract(x.id)} target="_blank" rel="noreferrer">{x.id.slice(0, 6)}…{x.id.slice(-4)}</a></div>}</td>
                  <td className="mono">{fmtCompact(x.reserveA)} / {fmtCompact(x.reserveB)}</td>
                  <td className="mono">{fmtCompact(tvl(x))}</td>
                  <td className="mono">{chain.live && !x.volumeLive ? "n/a" : fmtCompact(x.volume24h)}</td>
                  <td className="mono pos">{fmt(feeApr(x), 1)}%</td>
                  <td><button className="btn small ghost" onClick={() => setSelId(x.id)}>Select</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: "0.78rem" }}>*Fee APR = 24h volume × LP fee share annualised; illustrative, excludes impermanent loss. {chain.live ? "Volume is summed from on-chain swap events (last ~24h of ledgers)." : ""}</p>
          <div className="grid g-3" style={{ marginTop: 14 }}>
            <Stat label="Spot price" value={`${fmt(ratio, ratio < 0.01 ? 8 : 5)}`} sub={`${p.b} per ${p.a}`} />
            <Stat label="Total QLP" value={fmtCompact(p.totalShares)} sub="1,000 units locked forever" />
            <Stat label={viewer.isDemo ? "Seeded LP's share" : "Your share"} value={`${fmt((p.myShares / (p.totalShares || 1)) * 100, 3)}%`} sub={live ? `${fmtCompact(p.myShares)} QLP on-chain` : "connect wallet"} />
          </div>
          {chain.live && <ViewerNote {...viewer} role="LP (deployer)" />}
        </div>
        <div className="card glow" data-testid="pool-panel">
          <h2 className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {A && <AssetLogo code={A.code} logo={A.logo} size={22} />}{B && <AssetLogo code={B.code} logo={B.logo} size={22} />}
            {p.a}/{p.b}
            {A && <AssetBadge a={A} small />}{B && <AssetBadge a={B} small />}
          </h2>
          {selAsset && (
            <p className="muted" style={{ fontSize: "0.72rem", marginTop: -6 }}>
              v3 pool <a className="mono" href={expertContract(selAsset.pool!)} target="_blank" rel="noreferrer">{selAsset.pool!.slice(0, 6)}…{selAsset.pool!.slice(-4)}</a>.{" "}
              {[A, B].filter((x) => x && x.testnet.kind === "mirror").map((x) => <span key={x!.id}>{x!.code} here is a testnet mirror of <a href={mainnetUrl(x!)!} target="_blank" rel="noreferrer">{x!.code} ({x!.mainnet?.homeDomain ?? x!.mainnet?.issuer.slice(0, 6)}) on mainnet ↗</a> — not redeemable, no value. </span>)}
              {[A, B].filter((x) => x && x.testnet.kind === "real").map((x) => <span key={x!.id}>{x!.code} is the real testnet asset (official testnet issuer). </span>)}
            </p>
          )}
          <Tabs value={mode} onChange={setMode} options={[{ v: "deposit", label: "Soroban deposit" }, { v: "withdraw", label: "Withdraw" }, ...(nativeAsset ? [{ v: "native" as const, label: "Native LP" }] : [])]} />
          {missingTrust.length > 0 && mode !== "withdraw" && (
            <div className="notice warn" style={{ marginBottom: 10 }}>
              Your account needs a trustline to {missingTrust.map((x) => x.testnet.code).join(" and ")} to hold it (0.5 XLM reserve each).{" "}
              {missingTrust.map((x) => <button key={x.id} className="btn small" disabled={tx.busy} onClick={() => tx.run(`trustline ${x.testnet.code}`, async () => after((await submitSignedXdr(await tx.wallet.sign(await buildTrustline(tx.wallet.address!, classicOf(x)!)))).hash.slice(0, 10)))}>Add {x.testnet.code} trustline</button>)}
              <div className="muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>Get testnet tokens by swapping XLM on the <Link to="/trade">Trade</Link> page (routes through the router).</div>
            </div>
          )}
          {mode === "native" && nativeAsset ? (
            <>
              <p className="muted" style={{ fontSize: "0.8rem" }}>Stellar protocol-level liquidity pool (CAP-38) for XLM/{nativeAsset.getCode()} on testnet — no Soroban contract involved. {native.data ? `Reserves ${fmtCompact(native.data.reserveA)} XLM / ${fmtCompact(native.data.reserveB)} ${nativeAsset.getCode()}, ${native.data.holders} LPs.` : "Pool not created yet: your deposit creates it."}</p>
              <div className="field"><label>XLM</label><input className="input" value={amtA} onChange={(e) => setAmtA(e.target.value)} /></div>
              <div className="field"><label>{nativeAsset.getCode()} (pool ratio)</label><input className="input" readOnly value={fmt(Number(amtA) * nativeRatio, 4)} /></div>
              <button className="btn block" disabled={tx.busy} onClick={() => tx.run("native LP deposit", async () => {
                const me = tx.wallet.address!;
                const xdr = await buildNativeLpDeposit(me, Asset.native(), nativeAsset, Number(amtA), Number(amtA) * nativeRatio, slip);
                return after((await submitSignedXdr(await tx.wallet.sign(xdr))).hash.slice(0, 10));
              })}>Deposit to native pool</button>
              <p className="muted" style={{ fontSize: "0.72rem" }}>Adds the {nativeAsset.getCode()} and pool-share trustlines if missing (0.5 XLM reserve each).</p>
            </>
          ) : mode === "deposit" ? (
            <>
              <div className="field"><label>{p.a}</label><input className="input" value={amtA} onChange={(e) => setAmtA(e.target.value)} data-testid="deposit-a" /></div>
              <div className="field"><label>{p.b} (matched to pool ratio)</label><input className="input" readOnly value={fmt(amtB, amtB < 0.01 ? 7 : 4)} /></div>
              <div className="row between" style={{ fontSize: "0.85rem" }}><span className="muted">QLP minted (est.)</span><span className="mono">{fmt(newShares, 4)}</span></div>
              <div className="row between" style={{ fontSize: "0.78rem", marginBottom: 6 }} data-testid="deposit-mins"><span className="muted">Minimums (−{slippage}%)</span><span className="mono">{fmt(Number(amtA) * (1 - slip), 4)} {p.a} · {fmt(amtB * (1 - slip), amtB < 0.01 ? 7 : 4)} {p.b}</span></div>
              <div className="field"><label>Max slippage: {slippage}%</label><input type="range" min={0.1} max={5} step={0.1} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} /></div>
              <button className="btn block" disabled={tx.busy || !(Number(amtA) > 0) || !(amtB > 0)} onClick={() => tx.run("deposit", async () => {
                const me = tx.wallet.address!;
                const r = await invokeContract(me, tx.wallet.sign, p.id, "deposit", [addr(me), i128(toUnits(Number(amtA))), i128(toUnits(amtB)), i128(minUnits(Number(amtA))), i128(minUnits(amtB))]);
                return after(r.hash.slice(0, 10));
              })}>Add liquidity</button>
            </>
          ) : (
            <>
              <div className="field"><label>QLP shares to burn</label><input className="input" value={shares} onChange={(e) => setShares(e.target.value)} /></div>
              <div className="row between" style={{ fontSize: "0.85rem" }}><span className="muted">You receive</span><span className="mono">{fmt(outA, 4)} {p.a}</span></div>
              <div className="row between" style={{ fontSize: "0.85rem" }}><span /><span className="mono">{fmt(outB, outB < 0.01 ? 7 : 4)} {p.b}</span></div>
              <div className="row between" style={{ fontSize: "0.78rem", marginBottom: 6 }} data-testid="withdraw-mins"><span className="muted">Minimums (−{slippage}%)</span><span className="mono">{fmt(outA * (1 - slip), 4)} · {fmt(outB * (1 - slip), outB < 0.01 ? 7 : 4)}</span></div>
              <div className="field"><label>Max slippage: {slippage}%</label><input type="range" min={0.1} max={5} step={0.1} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} /></div>
              <button className="btn block" disabled={tx.busy || !(Number(shares) > 0)} onClick={() => tx.run("withdraw", async () => {
                const me = tx.wallet.address!;
                const r = await invokeContract(me, tx.wallet.sign, p.id, "withdraw", [addr(me), i128(toUnits(Number(shares))), i128(minUnits(outA)), i128(minUnits(outB))]);
                return after(r.hash.slice(0, 10));
              })}>Remove liquidity</button>
            </>
          )}
          <TxStatus status={tx.status} />
          <div className="notice" style={{ marginTop: 14 }}>Impermanent loss: when prices move, LPs end up with more of the asset that fell. Fees may or may not compensate.</div>
          <div className={`notice ${risk === "high" ? "warn" : ""}`} style={{ marginTop: 8 }} data-testid="il-pair-note">
            {risk === "high"
              ? <>Stable-vs-volatile pairs (e.g. USDC/XLM, SHX/XLM) and cross-currency pairs have <b>more impermanent loss</b> than same-peg stablecoin pairs: {p.a}/{p.b} can move a lot.</>
              : <>{p.a}/{p.b} is a same-peg stablecoin pair: lower impermanent loss while both hold their peg (a de-peg still causes losses). Stable-vs-volatile pairs have more impermanent loss.</>}
          </div>
          <Link className="calc-panel-link" to={`/calculators?c=lp${live ? `&pool=${p.id}` : ""}`} data-testid="pools-calc-link">🧮 Estimate fees &amp; impermanent loss for {p.a}/{p.b} →</Link>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }} data-testid="asset-pools">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Asset pools (v3)</h2>
            <p className="muted" style={{ fontSize: "0.78rem", margin: "4px 0 0" }}>Every stablecoin vs XLM, same-peg stable pairs vs USDC/EURC, and popular assets vs XLM. Seeded with modest testnet liquidity at live mainnet price ratios. Swaps route through the v3 router.</p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <SourceTag {...assetLive} />
            <Tabs value={cat} onChange={setCat} options={[{ v: "all", label: "All" }, { v: "stablecoin", label: "Stablecoins" }, { v: "popular", label: "Popular assets" }]} />
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="t" style={{ marginTop: 10 }}>
            <thead><tr><th>Pair</th><th>Testnet assets</th><th>Reserves</th><th>Spot</th><th>Mainnet reference</th><th /></tr></thead>
            <tbody>
              {visiblePools.map((lp) => {
                const v = assetView(lp);
                const base = assetById(lp.base)!, quote = assetById(lp.quote)!;
                const spot = v.reserveA > 0 ? (lp.assetA === lp.base ? v.reserveB / v.reserveA : v.reserveA / v.reserveB) : 0;
                return (
                  <tr key={lp.pool} style={{ outline: lp.pool === selId ? "1px solid var(--quasar)" : undefined }}>
                    <td><div className="row" style={{ gap: 6 }}><AssetLogo code={base.code} logo={base.logo} size={20} /><b>{lp.pair}</b></div><a className="mono muted" style={{ fontSize: "0.68rem" }} href={expertContract(lp.pool!)} target="_blank" rel="noreferrer">{lp.pool!.slice(0, 6)}…{lp.pool!.slice(-4)}</a></td>
                    <td><div className="row" style={{ gap: 4, flexWrap: "wrap" }}>{[base, quote].filter((x) => x.testnet.kind !== "native").map((x) => <AssetBadge key={x.id} a={x} small />)}</div></td>
                    <td className="mono" style={{ fontSize: "0.78rem" }}>{fmtCompact(v.reserveA)} {v.a} / {fmtCompact(v.reserveB)} {v.b}</td>
                    <td className="mono" style={{ fontSize: "0.78rem" }}>{spot < 0.01 ? spot.toPrecision(4) : fmt(spot, 4)} {quote.code}</td>
                    <td style={{ fontSize: "0.72rem" }}>{base.mainnet ? <a href={base.mainnet.expert} target="_blank" rel="noreferrer">{base.code} · {base.mainnet.homeDomain ?? `${base.mainnet.issuer.slice(0, 6)}…`} ↗</a> : <span className="muted">{base.testnet.label}</span>}</td>
                    <td><button className="btn small ghost" onClick={() => pickPool(lp)}>Supply</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: "0.72rem" }}>
          Mainnet issuers don't exist on testnet. <b>REAL testnet</b> = the official testnet asset (Circle's testnet USDC). <b>testnet mirror of X</b> = a Quasaria mock (code mk&lt;CODE&gt;, issuer home_domain *.quasaria.invalid) that mirrors the mainnet asset for testing: not redeemable, no value. Mainnet codes/issuers were verified read-only against Horizon and each issuer's stellar.toml (see config/assets.mainnet.json). Quasaria never trades on mainnet.
        </p>
      </div>

      <div className="card" style={{ marginTop: 18 }} data-testid="retired-pools">
        <div className="row between"><h2 style={{ margin: 0, fontSize: "1rem" }}>Retired v2 stablecoin pools ({RETIRED_POOLS.length})</h2><button className="btn small ghost" onClick={() => setShowRetired((s) => !s)}>{showRetired ? "Hide" : "Show IDs"}</button></div>
        <p className="muted" style={{ fontSize: "0.75rem", margin: "4px 0 0" }}>{RETIRED_NOTE} Replaced by the v3 asset pools above.</p>
        {showRetired && <div className="mono muted" style={{ fontSize: "0.7rem", marginTop: 8, columns: 2 }}>{RETIRED_POOLS.map((r) => <div key={r.pool}>{r.pair} · <a href={expertContract(r.pool)} target="_blank" rel="noreferrer">{r.pool.slice(0, 6)}…{r.pool.slice(-4)}</a></div>)}</div>}
      </div>
    </>
  );
}
