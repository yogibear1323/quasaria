import { useState } from "react";
import { PageHead, SourceTag, Stat, Tabs, TxStatus, ViewerNote, useTx } from "../components/ui";
import { DEMO_POOLS } from "../lib/demo";
import { CONTRACTS, expertContract, symbolOf } from "../lib/config";
import { addr, i128, invokeContract } from "../lib/soroban";
import { poolVolumes, readPool, tokenBalance, useChain, useViewer } from "../lib/chain";
import { fmt, fmtCompact, toUnits } from "../lib/format";

type PoolView = (typeof DEMO_POOLS)[number] & { volumeLive?: boolean };

export default function Pools() {
  const viewer = useViewer("lp");
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amtA, setAmtA] = useState("1000");
  const [shares, setShares] = useState("100");
  const [nonce, setNonce] = useState(0);
  const tx = useTx();

  const chain = useChain(async () => {
    const infos = await Promise.all(CONTRACTS.pools.map(readPool));
    const [mine, vols] = await Promise.all([
      Promise.all(infos.map((p) => (viewer.address ? tokenBalance(p.id, viewer.address) : Promise.resolve(0)))),
      poolVolumes(infos).catch(() => null),
    ]);
    return infos.map<PoolView>((p, i) => ({
      id: p.id, a: symbolOf(p.tokenA), b: symbolOf(p.tokenB), reserveA: p.reserveA, reserveB: p.reserveB, totalShares: p.totalShares, feeBps: p.feeBps,
      volume24h: vols ? vols[p.id] : 0, volumeLive: Boolean(vols), myShares: mine[i],
    }));
  }, [viewer.address, nonce]);
  const pools: PoolView[] = chain.data ?? DEMO_POOLS;

  const p = pools[Math.min(sel, pools.length - 1)];
  const ratio = p.reserveB / p.reserveA;
  const amtB = Number(amtA) * ratio;
  const newShares = p.totalShares ? (Number(amtA) / p.reserveA) * p.totalShares : Math.sqrt(Number(amtA) * amtB);
  const tvl = (x: PoolView) => x.reserveB * 2; // quote-denominated
  const feeApr = (x: PoolView) => (tvl(x) ? ((x.volume24h * x.feeBps * 0.8) / 10_000 / tvl(x)) * 365 * 100 : 0);
  const after = (r: string) => {
    setNonce((n) => n + 1);
    return r;
  };

  return (
    <>
      <PageHead kicker="Scene · Nebula Drift" title="Liquidity Pools" right={<div className="row"><SourceTag {...chain} /><span className="pill pink">Constant product · SEP-41 LP shares</span></div>}>
        Deposit both assets into an x·y=k pool, receive QLP share tokens, and earn 80% of the 0.30% swap fee (20% goes to the trader's referrer, if any).
      </PageHead>
      <div className="grid g-main-side">
        <div className="card">
          <h2>Pools</h2>
          <table className="t">
            <thead><tr><th>Pool</th><th>Reserves</th><th>TVL (quote)</th><th>24h volume</th><th>Fee APR*</th><th /></tr></thead>
            <tbody>
              {pools.map((x, i) => (
                <tr key={x.id} onClick={() => setSel(i)} style={{ cursor: "pointer", outline: i === sel ? "1px solid var(--quasar)" : undefined }}>
                  <td><b>{x.a}</b><span className="muted"> / {x.b}</span>{chain.live && <div><a className="mono muted" style={{ fontSize: "0.7rem" }} href={expertContract(x.id)} target="_blank" rel="noreferrer">{x.id.slice(0, 6)}…{x.id.slice(-4)}</a></div>}</td>
                  <td className="mono">{fmtCompact(x.reserveA)} / {fmtCompact(x.reserveB)}</td>
                  <td className="mono">{fmtCompact(tvl(x))}</td>
                  <td className="mono">{chain.live && !x.volumeLive ? "n/a" : fmtCompact(x.volume24h)}</td>
                  <td className="mono pos">{fmt(feeApr(x), 1)}%</td>
                  <td><button className="btn small ghost" onClick={() => setSel(i)}>Select</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: "0.78rem" }}>*Fee APR = 24h volume × LP fee share annualised; illustrative, excludes impermanent loss. {chain.live ? "Volume is summed from on-chain swap events (last ~24h of ledgers)." : ""}</p>
          <div className="grid g-3" style={{ marginTop: 14 }}>
            <Stat label="Spot price" value={`${fmt(ratio, 5)}`} sub={`${p.b} per ${p.a}`} />
            <Stat label="Total QLP" value={fmtCompact(p.totalShares)} sub="1,000 units locked forever" />
            <Stat label={viewer.isDemo ? "Seeded LP's share" : "Your share"} value={`${fmt((p.myShares / (p.totalShares || 1)) * 100, 3)}%`} sub={chain.live ? `${fmtCompact(p.myShares)} QLP on-chain` : "connect wallet"} />
          </div>
          {chain.live && <ViewerNote {...viewer} role="LP (deployer)" />}
        </div>
        <div className="card glow">
          <h2>{p.a}/{p.b}</h2>
          <Tabs value={mode} onChange={setMode} options={[{ v: "deposit", label: "Deposit" }, { v: "withdraw", label: "Withdraw" }]} />
          {mode === "deposit" ? (
            <>
              <div className="field"><label>{p.a}</label><input className="input" value={amtA} onChange={(e) => setAmtA(e.target.value)} /></div>
              <div className="field"><label>{p.b} (matched to pool ratio)</label><input className="input" readOnly value={fmt(amtB, 4)} /></div>
              <div className="row between" style={{ fontSize: "0.85rem", marginBottom: 12 }}><span className="muted">QLP minted (est.)</span><span className="mono">{fmt(newShares, 4)}</span></div>
              <button className="btn block" disabled={tx.busy} onClick={() => tx.run("deposit", async () => {
                const me = tx.wallet.address!;
                const r = await invokeContract(me, tx.wallet.sign, p.id, "deposit", [addr(me), i128(toUnits(Number(amtA))), i128(toUnits(amtB * 1.005)), i128(0n), i128(0n)]);
                return after(r.hash.slice(0, 10));
              })}>Add liquidity</button>
            </>
          ) : (
            <>
              <div className="field"><label>QLP shares to burn</label><input className="input" value={shares} onChange={(e) => setShares(e.target.value)} /></div>
              <div className="row between" style={{ fontSize: "0.85rem" }}><span className="muted">You receive</span><span className="mono">{fmt((Number(shares) / p.totalShares) * p.reserveA, 4)} {p.a}</span></div>
              <div className="row between" style={{ fontSize: "0.85rem", marginBottom: 12 }}><span /><span className="mono">{fmt((Number(shares) / p.totalShares) * p.reserveB, 4)} {p.b}</span></div>
              <button className="btn block" disabled={tx.busy} onClick={() => tx.run("withdraw", async () => {
                const me = tx.wallet.address!;
                const r = await invokeContract(me, tx.wallet.sign, p.id, "withdraw", [addr(me), i128(toUnits(Number(shares))), i128(0n), i128(0n)]);
                return after(r.hash.slice(0, 10));
              })}>Remove liquidity</button>
            </>
          )}
          <TxStatus status={tx.status} />
          <div className="notice" style={{ marginTop: 14 }}>Impermanent loss: when prices move, LPs end up with more of the asset that fell. Fees may or may not compensate.</div>
        </div>
      </div>
    </>
  );
}
