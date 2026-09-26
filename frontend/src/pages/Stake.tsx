import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHead, SourceTag, Stat, TxStatus, ViewerNote, useTx } from "../components/ui";
import { DEMO_STAKING } from "../lib/demo";
import { CONTRACTS, symbolOf } from "../lib/config";
import { addr, i128, invokeContract, u32 } from "../lib/soroban";
import { readStaking, useChain, useViewer, type StakePos } from "../lib/chain";
import { fmt, fmtCompact, toUnits } from "../lib/format";

type Row = (typeof DEMO_STAKING)[number];

export default function Stake() {
  const viewer = useViewer("trader");
  const [amount, setAmount] = useState<Record<number, string>>({});
  const [nonce, setNonce] = useState(0);
  const tx = useTx();

  const chain = useChain(async () => {
    const { pools, positions } = await readStaking(viewer.address);
    return { rows: pools.map<Row>((p) => ({ id: p.id, stake: symbolOf(p.stakeToken), reward: symbolOf(p.rewardToken), ratePerSec: p.ratePerSec, lockDays: p.lockDays, totalStaked: p.totalStaked, reserve: p.reserve, active: p.active })), positions };
  }, [viewer.address, nonce]);
  const pools: Row[] = chain.data?.rows ?? DEMO_STAKING;
  const positions: Record<number, StakePos> = chain.data?.positions ?? {};

  const call = (label: string, method: string, id: number, amt?: number) =>
    tx.run(label, async () => {
      const me = tx.wallet.address!;
      const args = [addr(me), u32(id)];
      if (amt !== undefined) args.push(i128(toUnits(amt)));
      const h = (await invokeContract(me, tx.wallet.sign, CONTRACTS.staking, method, args)).hash.slice(0, 10);
      setNonce((n) => n + 1);
      return h;
    });

  return (
    <>
      <PageHead kicker="Scene · Orbital Rings" title="Stake" right={<div className="row"><SourceTag {...chain} /><span className="pill gold">Admin-whitelisted orbits</span><Link className="pill cyan" to="/calculators?c=staking">🧮 Staking calculator</Link></div>}>
        Put whitelisted tokens into orbit. Each pool streams its own reward rate from a pre-funded reserve; some pools have lock periods for boosted rewards.
      </PageHead>
      <div className="grid g-3">
        {pools.map((p) => {
          const yearly = p.ratePerSec * 31_536_000;
          const apr = p.totalStaked ? (yearly / p.totalStaked) * 100 : 0;
          const runway = p.ratePerSec ? p.reserve / p.ratePerSec / 86400 : 0;
          const pos = positions[p.id];
          const locked = pos && pos.unlockAt * 1000 > Date.now();
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
              {pos && (
                <div className="grid g-2" style={{ marginBottom: 12 }}>
                  <Stat label={viewer.isDemo ? "Demo trader staked" : "Your stake"} value={fmt(pos.amount, 2)} sub={pos.amount > 0 && p.lockDays > 0 ? (locked ? `locked until ${new Date(pos.unlockAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "unlocked") : p.stake} />
                  <Stat label="Pending rewards" value={fmt(pos.pending, 4)} sub={p.reward} className="pos" />
                </div>
              )}
              <div className="field"><label>Amount</label><input className="input" placeholder="0.0" value={amount[p.id] ?? ""} onChange={(e) => setAmount({ ...amount, [p.id]: e.target.value })} /></div>
              <div className="row">
                <button className="btn" style={{ flex: 1 }} disabled={tx.busy} onClick={() => call("stake", "stake", p.id, Number(amount[p.id] || 0))}>Stake</button>
                <button className="btn ghost" disabled={tx.busy} onClick={() => call("unstake", "unstake", p.id, Number(amount[p.id] || 0))}>Unstake</button>
                <button className="btn ghost" disabled={tx.busy} onClick={() => call("claim", "claim", p.id)}>Claim</button>
              </div>
              <Link className="calc-panel-link" to={`/calculators?c=staking&pool=${p.id}`} data-testid={`stake-calc-link-${p.id}`}>🧮 Estimate rewards for this pool →</Link>
            </div>
          );
        })}
      </div>
      {chain.live && <ViewerNote {...viewer} role="demo trader" />}
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
