import { useMemo, useState } from "react";
import { PageHead, RiskWarning, Stat, Tabs, TxStatus, useTx } from "../components/ui";
import { DEMO_POSITIONS } from "../lib/demo";
import { CONTRACTS } from "../lib/config";
import { addr, assetOther, bool, i128, invokeContract, u32, u64 } from "../lib/soroban";
import { healthFactor, liquidationPrice, pnl } from "../lib/math";
import { fmt, toUnits } from "../lib/format";

type Strat = "grid" | "dca" | "momentum";
const MAX_LEV = 10; // mirrors vault config (hard cap 20x on-chain)
const MM_BPS = 500;

export default function Bots() {
  const [ack, setAck] = useState(false);
  const [strat, setStrat] = useState<Strat>("grid");
  const [side, setSide] = useState<"long" | "short">("long");
  const [lev, setLev] = useState(3);
  const [margin, setMargin] = useState("100");
  const [sl, setSl] = useState("8");
  const [tp, setTp] = useState("15");
  const [grid, setGrid] = useState({ lower: "0.10", upper: "0.14", levels: "8" });
  const [dca, setDca] = useState({ intervalH: "24", orders: "10" });
  const [mom, setMom] = useState({ fast: "9", slow: "21" });
  const tx = useTx();
  const mark = 0.1234;
  const size = Number(margin) * lev;
  const liq = liquidationPrice(side === "long", Number(margin), size, mark, MM_BPS);

  const config = useMemo(() => {
    const base = { id: `${strat}-xlm`, type: strat, asset: "XLM", side, leverage: lev, margin: Number(margin), stopLossPct: Number(sl), takeProfitPct: Number(tp) };
    const extra =
      strat === "grid" ? { lower: Number(grid.lower), upper: Number(grid.upper), levels: Number(grid.levels) }
      : strat === "dca" ? { intervalSec: Number(dca.intervalH) * 3600, maxOrders: Number(dca.orders) }
      : { fastPeriod: Number(mom.fast), slowPeriod: Number(mom.slow) };
    return { network: "testnet", strategies: [{ ...base, ...extra }], risk: { maxLeverage: MAX_LEV, maxOpenPositions: 5, maxDailyLossPct: 10 }, keeper: { enabled: true, intervalSec: 30 } };
  }, [strat, side, lev, margin, sl, tp, grid, dca, mom]);

  const download = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "quasaria-bot.config.json";
    a.click();
  };

  return (
    <>
      <PageHead kicker="Scene · Warp Speed" title="Bots & Leverage" right={<span className="pill pink">Max {MAX_LEV}× · oracle: Reflector-compatible</span>}>
        Configure automated grid, DCA and momentum strategies that trade leveraged positions in the Warp vault — with on-chain stop-loss / take-profit and a liquidation keeper.
      </PageHead>
      <RiskWarning />
      <div className="grid g-main-side">
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card glow">
            <h2>Strategy builder</h2>
            <Tabs value={strat} onChange={setStrat} options={[{ v: "grid", label: "Grid" }, { v: "dca", label: "DCA" }, { v: "momentum", label: "Momentum" }]} />
            <div className="grid g-3">
              <div className="field"><label>Direction</label>
                <select className="input" value={side} onChange={(e) => setSide(e.target.value as "long" | "short")}><option value="long">Long</option><option value="short">Short</option></select>
              </div>
              <div className="field"><label>Margin per order (QUSD)</label><input className="input" value={margin} onChange={(e) => setMargin(e.target.value)} /></div>
              <div className="field"><label>Leverage: <b className={lev > 5 ? "neg" : "gold"}>{lev}×</b></label><input type="range" min={1} max={MAX_LEV} value={lev} onChange={(e) => setLev(Number(e.target.value))} /></div>
              {strat === "grid" && (<>
                <div className="field"><label>Lower price</label><input className="input" value={grid.lower} onChange={(e) => setGrid({ ...grid, lower: e.target.value })} /></div>
                <div className="field"><label>Upper price</label><input className="input" value={grid.upper} onChange={(e) => setGrid({ ...grid, upper: e.target.value })} /></div>
                <div className="field"><label>Grid levels</label><input className="input" value={grid.levels} onChange={(e) => setGrid({ ...grid, levels: e.target.value })} /></div>
              </>)}
              {strat === "dca" && (<>
                <div className="field"><label>Interval (hours)</label><input className="input" value={dca.intervalH} onChange={(e) => setDca({ ...dca, intervalH: e.target.value })} /></div>
                <div className="field"><label>Max orders</label><input className="input" value={dca.orders} onChange={(e) => setDca({ ...dca, orders: e.target.value })} /></div>
                <div />
              </>)}
              {strat === "momentum" && (<>
                <div className="field"><label>Fast EMA</label><input className="input" value={mom.fast} onChange={(e) => setMom({ ...mom, fast: e.target.value })} /></div>
                <div className="field"><label>Slow EMA</label><input className="input" value={mom.slow} onChange={(e) => setMom({ ...mom, slow: e.target.value })} /></div>
                <div />
              </>)}
              <div className="field"><label>Stop-loss (%)</label><input className="input" value={sl} onChange={(e) => setSl(e.target.value)} /></div>
              <div className="field"><label>Take-profit (%)</label><input className="input" value={tp} onChange={(e) => setTp(e.target.value)} /></div>
            </div>
            <div className="grid g-4" style={{ margin: "8px 0 14px" }}>
              <Stat label="Notional" value={fmt(size, 2)} sub="QUSD" />
              <Stat label="Est. liq. price" value={fmt(liq, 5)} className="neg" sub={`mark ${mark}`} />
              <Stat label="Distance to liq." value={`${fmt((Math.abs(mark - liq) / mark) * 100, 1)}%`} />
              <Stat label="Open fee" value={fmt(size * 0.001, 3)} sub="0.10% notional" />
            </div>
            <label className="row" style={{ fontSize: "0.88rem", marginBottom: 12 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand leveraged, automated trading can lose my entire margin quickly, this is unaudited testnet software, and it is not financial advice.
            </label>
            <div className="row">
              <button className="btn" disabled={!ack} onClick={download}>Export bot config</button>
              <button className="btn ghost" disabled={!ack || tx.busy} onClick={() => tx.run("open position", async () => {
                const me = tx.wallet.address!;
                return (await invokeContract(me, tx.wallet.sign, CONTRACTS.vault, "open_position", [addr(me), addr(me), assetOther("XLM"), bool(side === "long"), i128(toUnits(Number(margin))), u32(lev * 10_000)])).hash.slice(0, 10);
              })}>Open manually</button>
              <button className="btn ghost" disabled={!ack || tx.busy} onClick={() => {
                const op = window.prompt("Bot operator address (G…) — it can trade but never withdraw:");
                if (op) tx.run("set operator", async () => (await invokeContract(tx.wallet.address!, tx.wallet.sign, CONTRACTS.vault, "set_operator", [addr(tx.wallet.address!), addr(op)])).hash.slice(0, 10));
              }}>Delegate bot key</button>
            </div>
            <TxStatus status={tx.status} />
          </div>
          <div className="card">
            <h2>Open positions</h2>
            <table className="t">
              <thead><tr><th>#</th><th>Side</th><th>Margin</th><th>Lev.</th><th>Entry → Mark</th><th>PnL</th><th>Health</th><th>SL / TP</th><th /></tr></thead>
              <tbody>
                {DEMO_POSITIONS.map((p) => {
                  const s = p.margin * p.leverage;
                  const v = pnl(p.isLong, s, p.entry, p.mark);
                  const hf = healthFactor(p.margin, s, v, MM_BPS);
                  return (
                    <tr key={p.id}>
                      <td className="mono">{p.id}</td>
                      <td className={p.isLong ? "pos" : "neg"}>{p.isLong ? "LONG" : "SHORT"} {p.asset}</td>
                      <td className="mono">{fmt(p.margin, 0)}</td>
                      <td className="mono">{p.leverage}×</td>
                      <td className="mono">{p.entry} → {p.mark}</td>
                      <td className={`mono ${v >= 0 ? "pos" : "neg"}`}>{v >= 0 ? "+" : ""}{fmt(v, 2)}</td>
                      <td style={{ minWidth: 110 }}>
                        <div className="gauge"><i style={{ left: `${Math.min(100, (hf / 5) * 100)}%` }} /></div>
                        <span className="mono" style={{ fontSize: "0.75rem" }}>HF {fmt(hf, 2)}</span>
                      </td>
                      <td className="mono muted">{p.sl} / {p.tp}</td>
                      <td><button className="btn small ghost" onClick={() => tx.run("close", async () => (await invokeContract(tx.wallet.address!, tx.wallet.sign, CONTRACTS.vault, "close_position", [addr(tx.wallet.address!), u64(p.id)])).hash.slice(0, 10))}>Close</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: "0.78rem" }}>Demo positions shown. Health factor = equity ÷ maintenance margin (5% of notional); below 1.0 anyone can liquidate.</p>
          </div>
        </div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card">
            <h2>Bot config preview</h2>
            <pre className="mono" style={{ fontSize: "0.72rem", whiteSpace: "pre-wrap", maxHeight: 330, overflow: "auto", margin: 0, color: "var(--quasar)" }}>{JSON.stringify(config, null, 2)}</pre>
            <p className="muted" style={{ fontSize: "0.8rem" }}>Run it: <span className="mono">cd bot && npm start -- --config quasaria-bot.config.json</span> (paper mode by default).</p>
          </div>
          <div className="card">
            <h2>Keeper status</h2>
            <div className="grid g-2">
              <Stat label="Liquidation keeper" value={<span className="pos">● demo</span>} sub="scans open_position_ids()" />
              <Stat label="SL/TP executor" value={<span className="pos">● demo</span>} sub="execute_trigger(id)" />
            </div>
            <ul className="muted" style={{ fontSize: "0.82rem", paddingLeft: 18 }}>
              <li>Bots trade via a delegated <b>operator</b> key that cannot withdraw funds.</li>
              <li>Stale oracle prices (older than max age) make the vault reject trades.</li>
              <li>Profits are paid from a finite liquidity reserve and are capped by it.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
