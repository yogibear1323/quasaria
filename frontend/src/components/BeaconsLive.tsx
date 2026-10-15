import { useEffect, useState } from "react";
import { addr, readContract } from "../lib/soroban";
import { useWallet } from "../lib/wallet";
import { BEACONS_TESTNET as B } from "../lib/beaconsTestnet";

const X = (v: unknown) => Number(BigInt(String(v ?? 0))) / 1e7;
const n = (v: number, d = 2) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const TIERS = ["—", "Spark", "Flare", "Beacon", "Pulsar", "Quasar", "Singularity"];
const exp = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;
type R = Record<string, any>;

export default function BeaconsLive() {
  const { address } = useWallet() as { address: string | null };
  const [d, setD] = useState<{ vault: R; reserve: R; peg: R; adapter: R; ins: number; routed: number; pos: R | null } | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const c = B.contracts;
        const [vault, reserve, peg, adapter, ins, routed, pos] = await Promise.all([
          readContract<R>(c.vault, "state"), readContract<R>(c.rewardReserve, "state"), readContract<R>(c.pegMonitor, "status"),
          readContract<R>(c.blendAdapter, "state"), readContract(c.insuranceFund, "balance"), readContract(c.feeRouter, "total_routed"),
          address ? readContract<R | null>(c.vault, "position", [addr(address)]).catch(() => null) : Promise.resolve(null),
        ]);
        if (live) { setD({ vault, reserve, peg, adapter, ins: X(ins), routed: X(routed), pos }); setErr(""); }
      } catch (e) { if (live) setErr(String((e as Error).message || e)); }
    };
    load(); const t = setInterval(load, 20_000); const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { live = false; clearInterval(t); clearInterval(c); };
  }, [address]);
  const next = d ? Math.max(0, Number(d.reserve.next_cycle) - Math.floor(now / 1000)) : 0;
  const demo = d ? Boolean(d.reserve.demo_timing) : B.params.demoTiming;
  const cyc = d ? Number(d.reserve.cycle_secs) : B.params.cycleSecs;
  const unb = d ? Number(d.vault.unbond_secs) : B.params.unbondSecs;
  const dur = (s: number) => s >= 86400 ? `${s / 86400}-day` : s >= 3600 ? `${s / 3600}-hour` : `${s}s`;
  return (
    <section className="bp-sec bp-live" id="live-testnet" aria-labelledby="bp-live">
      <h2 id="bp-live">Live on testnet <span className="pill gold">Testnet · unaudited</span><span className="pill cyan" style={{ marginLeft: 6 }}>{demo ? "Demo timing" : "Production timing"}: {dur(cyc)} cycles · {dur(unb)} unbonding</span></h2>
      <p className="muted">Live numbers from the six testnet contracts, updated every 20 seconds. {demo ? "Demo timing is on, so cycles are short." : "Payouts every 4 hours. Exits take 7 days."} Fees come from a <b>test fee source</b> for now.</p>
      {err && <div className="bp-banner">Could not read testnet contracts: {err}</div>}
      {!d ? <div className="card muted">Loading live testnet state…</div> : <>
        <div className="grid g-3">
          <div className="card"><div className="muted">Staked (QFX principal)</div><b className="mono bp-big">{n(X(d.vault.total_principal))}</b><div className="muted">{d.vault.stakers} staker{d.vault.stakers === 1 ? "" : "s"} · cycle {d.vault.cycle}</div></div>
          <div className="card"><div className="muted">Rewards paid to stakers (XLM)</div><b className="mono bp-big">{n(X(d.reserve.total_paid), 4)}</b><div className="muted">Reserve {n(X(d.reserve.balance))} XLM · next payout ≈ {n(X(d.reserve.next_payout), 4)} in {next}s</div></div>
          <div className="card"><div className="muted">Peg monitor</div><b className={"bp-big " + (d.peg.healthy ? "bp-good" : "bp-bad")}>{d.peg.healthy ? "Open" : "Paused"}</b><div className="muted">Backing {n(X(d.peg.backing), 4)} XLM per QFX · trips at {d.peg.threshold_bps / 100}% drift</div></div>
          <div className="card"><div className="muted">Blend XLM pool ({d.adapter.cash_only ? "cash-only mode" : "lending"})</div><b className="mono bp-big">{n(X(d.vault.lent))}</b><div className="muted">XLM supplied · cash buffer {n(X(d.vault.cash))} XLM</div></div>
          <div className="card"><div className="muted">Fee router (test fee source)</div><b className="mono bp-big">{n(d.routed)}</b><div className="muted">XLM routed 40 / 10 / 50 · insurance fund {n(d.ins)} XLM</div></div>
          <div className="card"><div className="muted">Exit queue (FIFO, 2% per cycle)</div><b className="mono bp-big">{d.vault.queue_len}</b><div className="muted">{n(X(d.vault.queued_amount))} QFX waiting · budget left {n(X(d.vault.exit_budget_left))}</div></div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          {!address ? <span className="muted">Connect a testnet wallet to see your Beacons position.</span>
            : !d.pos ? <span className="muted">No Beacons position for this wallet on testnet.</span>
            : <span>Your position: <b className="mono">{n(X(d.pos.amount))} QFX</b> · {TIERS[d.pos.tier]} · {d.pos.lock_days ? `${d.pos.lock_days}-day lock` : "no lock"} · {String(d.pos.status?.[0] ?? d.pos.status)} · claimable <b className="mono">{n(X(d.pos.claimable), 4)} XLM</b>{Number(d.pos.act_cycle) > Number(d.vault.cycle) && " · warming up (earns from next cycle)"}</span>}
        </div>
        <details className="card" style={{ marginTop: 12 }}><summary>Contract addresses (testnet)</summary><ul className="mono" style={{ fontSize: ".8rem", wordBreak: "break-all" }}>
          {Object.entries(B.contracts).map(([k, v]) => <li key={k}>{k}: <a href={exp(v)} target="_blank" rel="noreferrer">{v}</a></li>)}
          <li>QFX (unchanged): <a href={exp(B.external.qfx)} target="_blank" rel="noreferrer">{B.external.qfx}</a></li>
          <li>Blend testnet pool: <a href={exp(B.external.blendPool)} target="_blank" rel="noreferrer">{B.external.blendPool}</a></li>
        </ul></details>
      </>}
    </section>
  );
}
