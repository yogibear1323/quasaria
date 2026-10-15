import { useEffect, useState } from "react";
import { addr, i128, invokeContract, readContract, u32 } from "../lib/soroban";
import { useTx, TxStatus } from "./ui";
import { BEACONS_TESTNET as B } from "../lib/beaconsTestnet";

type R = Record<string, any>;
const TIERS = [["Spark", 100], ["Flare", 500], ["Beacon", 2_500], ["Pulsar", 10_000], ["Quasar", 50_000], ["Singularity", 250_000]] as const;
const LOCKS = [[0, "No lock", "1.00×"], [30, "30 days", "1.10×"], [90, "90 days", "1.25×"]] as const;
const X = (v: unknown) => Number(BigInt(String(v ?? 0))) / 1e7;
const n = (v: number, d = 2) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const units = (v: number) => BigInt(Math.round(v * 1e7));
const status = (s: unknown) => String(Array.isArray(s) ? s[0] : s);

/** Contract error codes -> plain messages (vault, peg monitor, gov, QFX/SAC). */
const ERRORS: Record<string, string> = {
  "1": "Below the 100 QFX minimum (Spark).", "2": "Lock must be none, 30 or 90 days.", "3": "This wallet already has a Beacons position. Use “Add to stake”.",
  "4": "No Beacons position for this wallet.", "5": "Still locked: unbonding opens when the lock ends.", "6": "Position is not active (already unbonding or closed).",
  "7": "Peg monitor has paused new stakes (QFX/XLM drift above 1%). Claims and exits keep working.", "9": "Vault not wired yet.",
  "900": "Beacons is paused by the guardian.", "10": "Not enough QFX in this wallet.",
};
export function explain(msg: string): string {
  const code = msg.match(/Error\(Contract, #(\d+)\)/)?.[1];
  if (code && ERRORS[code]) return `${ERRORS[code]} (error #${code})`;
  if (/insufficient|balance/i.test(msg)) return "Not enough QFX or XLM in this wallet.";
  return msg;
}

export default function BeaconsStake() {
  const tx = useTx(false);
  const w = tx.wallet;
  const me = w.address;
  const [amt, setAmt] = useState("100");
  const [lock, setLock] = useState<number>(0);
  const [nonce, setNonce] = useState(0);
  const [d, setD] = useState<{ qfx: number; xlm: number; pos: R | null; pend: [unknown, unknown]; vault: R; healthy: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const c = B.contracts;
        const [vault, healthy] = await Promise.all([readContract<R>(c.vault, "state"), readContract<boolean>(c.pegMonitor, "healthy")]);
        let qfx = 0, xlm = 0, pos: R | null = null, pend: [unknown, unknown] = [0, 0];
        if (me) {
          const r = await Promise.all([readContract(B.external.qfx, "balance", [addr(me)]), readContract(B.external.xlmSac, "balance", [addr(me)]).catch(() => 0),
            readContract<R | null>(c.vault, "position", [addr(me)]), readContract<[unknown, unknown]>(c.vault, "pending_add", [addr(me)]).catch(() => [0, 0] as [unknown, unknown])]);
          qfx = X(r[0]); xlm = X(r[1]); pos = r[2]; pend = r[3];
        }
        if (live) setD({ qfx, xlm, pos, pend, vault, healthy });
      } catch (e) { if (live) setErr(String((e as Error).message || e)); }
    })();
    return () => { live = false; };
  }, [me, nonce]);

  const act = (label: string, method: string, args: ReturnType<typeof addr>[]) => tx.run(label, async () => {
    try {
      const r = await invokeContract(me!, w.sign, B.contracts.vault, method, args);
      setNonce((x) => x + 1);
      return r.hash;
    } catch (e) { throw new Error(explain(e instanceof Error ? e.message : String(e))); }
  });

  const pos = d?.pos && status(d.pos.status) !== "Closed" ? d.pos : null;
  const active = pos && status(pos.status) === "Active";
  const amount = Number(amt) || 0;
  const total = amount + (pos ? X(pos.amount) : 0);
  const tierIdx = TIERS.reduce((t, [, min], i) => (total >= min ? i : t), -1);
  const paused = d ? !d.healthy : false;
  const lockedUntil = pos ? Number(pos.lock_until) * 1000 : 0;
  const stillLocked = lockedUntil > Date.now();
  const busy = tx.busy;
  const unbondEta = pos && status(pos.status) === "Unbonding" ? new Date(Number(pos.ready_at) * 1000) : null;
  const pendW = d ? X(d.pend[0]) : 0;

  return (
    <section className="bp-sec bp-stake" id="stake-testnet" aria-labelledby="bp-stake-h">
      <h2 id="bp-stake-h">Stake on testnet <span className="pill gold">Testnet · unaudited</span></h2>
      <p className="muted">This uses <b>Stellar testnet</b>, so test QFX has no value. Connect your wallet (in-app or Freighter on TESTNET). Need QFX? Swap testnet XLM for it 1:1 on the Swap or Earn page.</p>
      {!me ? <div className="card"><p style={{ margin: 0 }}>Connect a testnet wallet to stake.</p><button className="btn" style={{ marginTop: 10 }} onClick={() => w.openModal()}>Connect wallet</button></div>
      : w.wrongNetwork ? <div className="bp-banner bp-err" role="alert">Your wallet is on the wrong network. Switch Freighter to <b>TESTNET</b> to use Beacons. Mainnet is not supported.</div>
      : <>
        {paused && <div className="bp-banner bp-err" role="alert"><b>Peg monitor paused new stakes.</b> QFX/XLM drifted more than 1%. Staking and top-ups are disabled; claims, unbonding and exits still work.</div>}
        {err && <div className="bp-banner bp-err" role="alert">Could not read Beacons: {err}</div>}
        <div className="grid g-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{pos ? (active ? "Add to your stake" : "Stake") : "New stake"}</h3>
            <div className="muted">Wallet: <b className="mono">{n(d?.qfx ?? 0, 4)} QFX</b> · <span className="mono">{n(d?.xlm ?? 0)} XLM</span></div>
            <label className="bp-field">Amount (QFX)<input type="number" min={pos ? 0 : 100} step="any" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount in QFX" />
              <span className="row" style={{ gap: 6, marginTop: 6 }}>{TIERS.map(([name, min]) => <button key={name} type="button" className="pill" onClick={() => setAmt(String(Math.max(0, min - (pos ? X(pos.amount) : 0))))}>{name} {min.toLocaleString()}</button>)}</span>
            </label>
            {!pos && <div className="bp-seg" role="group" aria-label="Lock">{LOCKS.map(([days, label, boost]) => <button key={days} type="button" aria-pressed={lock === days} onClick={() => setLock(days)}>{label} · {boost}</button>)}</div>}
            <p className="muted" style={{ margin: "8px 0" }}>Tier after this: <b>{tierIdx >= 0 ? TIERS[tierIdx][0] : "below Spark (100 QFX min)"}</b>{pos && active ? ` · keeps your ${pos.lock_days ? `${pos.lock_days}-day` : "no"} lock${pos.lock_days ? " (lock end moves to today + lock)" : ""} · the added QFX starts earning next cycle` : " · starts earning from the next 4-hour cycle"}</p>
            {pos && !active ? <p className="muted">This stake is being withdrawn. Wait until that's done, then stake again.</p>
            : <button className="btn" disabled={busy || paused || amount <= 0 || (!pos && amount < 100) || amount > (d?.qfx ?? 0)}
                onClick={() => pos ? act(`Add ${n(amount)} QFX`, "add_stake", [addr(me), i128(units(amount))]) : act(`Stake ${n(amount)} QFX`, "stake", [addr(me), i128(units(amount)), u32(lock)])}>
                {paused ? "Paused by peg monitor" : pos ? "Add to stake" : "Stake QFX"}</button>}
            {amount > (d?.qfx ?? 0) && <p className="bp-bad" style={{ marginBottom: 0 }}>Not enough QFX in this wallet.</p>}
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Your position</h3>
            {!pos ? <p className="muted">No active Beacons position.</p> : <>
              <p style={{ margin: "0 0 6px" }}><b className="mono">{n(X(pos.amount))} QFX</b> · {TIERS[Number(pos.tier) - 1]?.[0] ?? "—"} · {pos.lock_days ? `${pos.lock_days}-day lock` : "no lock"} · <b>{status(pos.status)}</b></p>
              {active && Number(pos.act_cycle) > Number(d?.vault.cycle ?? 0) && <p className="muted" style={{ margin: "0 0 6px" }}>Warming up: earns from cycle {pos.act_cycle}.</p>}
              {pendW > 0 && <p className="muted" style={{ margin: "0 0 6px" }}>Top-up warming up: {n(pendW)} weight starts earning at cycle {String(d?.pend[1])}.</p>}
              {stillLocked && active && <p className="muted" style={{ margin: "0 0 6px" }}>Locked until {new Date(lockedUntil).toLocaleString()}.</p>}
              <p style={{ margin: "0 0 10px" }}>Claimable: <b className="mono">{n(X(pos.claimable), 7)} XLM</b></p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn ghost" disabled={busy || X(pos.claimable) <= 0} onClick={() => act("Claim XLM", "claim", [addr(me)])}>Claim XLM</button>
                {active && <button className="btn ghost" disabled={busy || stillLocked} onClick={() => { if (confirm("Start unbonding? Rewards stop now, and QFX is returned after the unbonding period, at most 2% of the vault per 4-hour cycle (first in, first out).")) act("Start unbonding", "unbond", [addr(me)]); }}>Start unbonding</button>}
              </div>
              {unbondEta && <div className="bp-queue"><b>Exit queue</b><br />{n(X(pos.amount))} QFX still to return · ready {unbondEta.toLocaleString()} · {d?.vault.queue_len} in queue ({n(X(d?.vault.queued_amount))} QFX) · this cycle's exit budget left {n(X(d?.vault.exit_budget_left))} QFX. The keeper pays exits in order each cycle; returned QFX lands in this wallet automatically.</div>}
            </>}
          </div>
        </div>
        <TxStatus status={tx.status} />
      </>}
    </section>
  );
}
