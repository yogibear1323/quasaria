import { useEffect, useState } from "react";
import { PageHead, Stat, TxStatus, useTx } from "../components/ui";
import { DEMO_STAKING } from "../lib/demo";
import { CONTRACTS, CONTRACTS_CONFIGURED } from "../lib/config";
import { addr, i128, invokeContract, readContract, u32 } from "../lib/soroban";
import { fmt, fmtCompact, fromUnits, toUnits } from "../lib/format";

type Row = (typeof DEMO_STAKING)[number];

export default function Stake() {
  const [pools, setPools] = useState<Row[]>(DEMO_STAKING);
  const [amount, setAmount] = useState<Record<number, string>>({});
  const tx = useTx();

  useEffect(() => {
    if (!CONTRACTS_CONFIGURED || !CONTRACTS.staking) return;
    (async () => {
      const n = await readContract<number>(CONTRACTS.staking, "pool_count");
      const rows: Row[] = [];
      for (let i = 0; i < n; i++) {
        const p = await readContract<{ reward_rate: bigint; lock_seconds: bigint; total_staked: bigint; reward_reserve: bigint; active: boolean }>(CONTRACTS.staking, "pool", [u32(i)]);
        rows.push({ ...DEMO_STAKING[i % DEMO_STAKING.length], id: i, ratePerSec: fromUnits(p.reward_rate), lockDays: Number(p.lock_seconds) / 86400, totalStaked: fromUnits(p.total_staked), reserve: fromUnits(p.reward_reserve), active: p.active });
      }
      setPools(rows);
    })().catch(() => void 0);
  }, []);

  const call = (label: string, method: string, id: number, amt?: number) =>
    tx.run(label, async () => {
      const me = tx.wallet.address!;
      const args = [addr(me), u32(id)];
      if (amt !== undefined) args.push(i128(toUnits(amt)));
      return (await invokeContract(me, tx.wallet.sign, CONTRACTS.staking, method, args)).hash.slice(0, 10);
    });

  return (
    <>
      <PageHead kicker="Scene · Orbital Rings" title="Stake" right={<span className="pill gold">Admin-whitelisted orbits</span>}>
        Put whitelisted tokens into orbit. Each pool streams its own reward rate from a pre-funded reserve; some pools have lock periods for boosted rewards.
      </PageHead>
      <div className="grid g-3">
        {pools.map((p) => {
          const yearly = p.ratePerSec * 31_536_000;
          const apr = p.totalStaked ? (yearly / p.totalStaked) * 100 : 0;
          const runway = p.ratePerSec ? p.reserve / p.ratePerSec / 86400 : 0;
          return (
            <div className="card glow" key={p.id}>
              <div className="row between"><h2 style={{ margin: 0 }}>{p.stake}</h2>{p.lockDays > 0 ? <span className="pill pink">🔒 {p.lockDays}d lock</span> : <span className="pill green">Flexible</span>}</div>
              <p className="muted" style={{ marginTop: 4 }}>Earn {p.reward} · pool #{p.id}</p>
              <div className="grid g-2" style={{ margin: "12px 0" }}>
                <Stat label="Reward APR*" value={`${fmt(apr, 1)}%`} className="gold" />
                <Stat label="Total staked" value={fmtCompact(p.totalStaked)} />
                <Stat label="Rate" value={`${fmt(p.ratePerSec * 86400, 1)}/day`} sub={p.reward} />
                <Stat label="Reserve runway" value={`${fmt(runway, 0)} days`} sub={`${fmtCompact(p.reserve)} funded`} />
              </div>
              <div className="field"><label>Amount</label><input className="input" placeholder="0.0" value={amount[p.id] ?? ""} onChange={(e) => setAmount({ ...amount, [p.id]: e.target.value })} /></div>
              <div className="row">
                <button className="btn" style={{ flex: 1 }} disabled={tx.busy} onClick={() => call("stake", "stake", p.id, Number(amount[p.id] || 0))}>Stake</button>
                <button className="btn ghost" disabled={tx.busy} onClick={() => call("unstake", "unstake", p.id, Number(amount[p.id] || 0))}>Unstake</button>
                <button className="btn ghost" disabled={tx.busy} onClick={() => call("claim", "claim", p.id)}>Claim</button>
              </div>
            </div>
          );
        })}
      </div>
      <TxStatus status={tx.status} />
      <div className="card" style={{ marginTop: 18 }}>
        <h2>How orbits work</h2>
        <ul className="muted">
          <li>Rewards accrue per second, pro-rata to your stake (accumulated reward-per-share, O(1) per user).</li>
          <li>Only <b>funded</b> rewards are distributed: when a pool's reserve hits zero the stream pauses until topped up.</li>
          <li>Lock pools: each stake resets your unlock time to <span className="mono">now + lock</span>. Claiming is always allowed; unstaking waits for unlock.</li>
        </ul>
        <p className="muted" style={{ fontSize: "0.78rem" }}>*APR assumes 1 reward token ≈ 1 stake token in value; illustrative only.</p>
      </div>
    </>
  );
}
