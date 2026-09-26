import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourceTag } from "../ui";
import { useChain } from "../../lib/chain";
import { demoCalcStaking, loadCalcStaking, type CalcStakePool } from "../../lib/calcData";
import { dayGrid, projectStaking, stakingApr, stakingRewardsAt, type StakingInput } from "../../lib/calc";
import { type Series, AmountField, CalcDisclaimer, CalcHead, CalcStat, DurationField, ProjectionChart, TokenUsd, fmtAmt, fmtD, fmtDays, fmtUsd, num, pctStr, useUsd } from "./common";

export default function StakingCalculator({ initialPool, embedded }: { initialPool?: number; embedded?: boolean }) {
  const chain = useChain(loadCalcStaking, []);
  const data = chain.data ?? (chain.loading ? null : demoCalcStaking());
  const usd = useUsd();
  const [poolId, setPoolId] = useState<number | null>(initialPool ?? null);
  const [amount, setAmount] = useState("100");
  const [days, setDays] = useState(30);

  const pools = data?.pools ?? [];
  useEffect(() => {
    if (poolId === null && pools.length) setPoolId((pools.find((p) => p.active) ?? pools[0]).id);
  }, [pools, poolId]);
  const p: CalcStakePool | undefined = pools.find((x) => x.id === poolId) ?? pools[0];

  const valueKnown = p ? Number.isFinite(p.stakeValueXlm) && Number.isFinite(p.rewardValueXlm) && p.rewardValueXlm > 0 : false;
  const svr = p && valueKnown ? p.stakeValueXlm / p.rewardValueXlm : 1;
  const amt = num(amount);
  const input: StakingInput | null = p ? { amount: amt, ratePerSec: p.active ? p.ratePerSec : 0, totalStaked: p.totalStaked, reserve: p.reserve, days, lockDays: p.lockDays, stakeValueInReward: svr } : null;
  const res = input ? projectStaking(input) : null;
  const series = useMemo((): Series[] => {
    if (!input || !res) return [];
    const grid = dayGrid(days);
    const s: Series[] = [{ name: `Your rewards (${p!.rewardSym}, reserve-capped)`, color: "#ffd166", fill: true, points: grid.map((d) => ({ x: d, y: stakingRewardsAt(input, d) })) }];
    if (res.reserveDepletes) s.push({ name: "If the reserve were unlimited", color: "#ff3dcb", fill: false, dashed: true, points: grid.map((d) => ({ x: d, y: res.dailyReward * d })) });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, amt, days, res?.dailyReward, res?.reserveDepletes]);

  const rv = p && valueKnown ? p.rewardValueXlm : p?.rewardSym === "QFX" ? 1 : NaN;
  const sv = p && valueKnown ? p.stakeValueXlm : NaN;
  const same = p ? p.stakeSym === p.rewardSym : false;

  return (
    <div className={`card glow calc ${embedded ? "embedded" : ""}`} data-testid="calc-staking">
      <CalcHead icon="🪐" kicker="Calculator · Orbit staking" title="Staking rewards" right={<><SourceTag {...chain} what="Pool rate, lock and reserve read from the staking contract" />{!embedded && <Link className="pill cyan" to="/stake">Open Stake →</Link>}</>} />
      {!data || !p || !res ? (
        <div className="calc-loading">⟳ Reading pool rates, locks and reserves from Soroban testnet…</div>
      ) : (
        <>
          <div className="field">
            <label>Pool / lock</label>
            <div className="calc-pools" role="radiogroup" aria-label="Staking pool">
              {pools.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={x.id === p.id} className={`calc-pool ${x.id === p.id ? "on" : ""}`} onClick={() => setPoolId(x.id)} data-testid={`stake-pool-${x.id}`}>
                  <b>{x.stakeSym}</b> <span className="muted">→ {x.rewardSym}</span>
                  <span className={`pill ${x.lockDays > 0 ? "pink" : "green"}`}>{x.lockDays > 0 ? `🔒 ${fmtD(x.lockDays)}d lock` : "Flexible"}</span>
                  <span className="mono gold">{x.active ? pctStr(stakingApr(x.ratePerSec, x.totalStaked, 0, Number.isFinite(x.stakeValueXlm / x.rewardValueXlm) ? x.stakeValueXlm / x.rewardValueXlm : 1), 1) : "inactive"}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="calc-grid">
            <div>
              <AmountField label="Amount to stake" value={amount} onChange={setAmount} unit={p.stakeSym} testId="stake-amount"
                hint={valueKnown ? <>≈ {fmtAmt(amt * sv)} XLM {fmtUsd(usd.ofXlm(amt * sv))}{same ? "" : ` · 1 ${p.stakeSym} ≈ ${fmtAmt(sv)} XLM at pool spot`}</> : "value of this token unknown"} />
              <DurationField days={days} onChange={setDays} />
              <div className="calc-facts">
                <div><span>Pool emission</span><b className="mono">{fmtAmt(p.ratePerSec * 86_400)} {p.rewardSym}/day</b></div>
                <div><span>Staked by others</span><b className="mono">{fmtAmt(p.totalStaked)} {p.stakeSym}</b></div>
                <div><span>Reward reserve left</span><b className="mono">{fmtAmt(p.reserve)} {p.rewardSym}</b></div>
                <div><span>Reserve runway</span><b className="mono">{fmtDays(res.runwayDays)}</b></div>
                <div><span>Lock</span><b className="mono">{p.lockDays > 0 ? `${fmtD(p.lockDays)} days (resets on each stake)` : "none"}</b></div>
              </div>
            </div>
            <div className="calc-results">
              <CalcStat label={`Est. rewards · ${days}d`} tone="gold" testId="stake-rewards"><TokenUsd amount={res.rewards} symbol={p.rewardSym} usd={usd.ofXlm(res.rewards * rv)} /></CalcStat>
              <CalcStat label="Total at the end" testId="stake-total">
                {same ? <TokenUsd amount={amt + res.rewards} symbol={p.stakeSym} usd={usd.ofXlm((amt + res.rewards) * sv)} /> : (
                  <>
                    <span>{fmtAmt(amt)} <small className="muted">{p.stakeSym}</small> + {fmtAmt(res.rewards)} <small className="muted">{p.rewardSym}</small></span>
                    <span className="calc-usd">{valueKnown ? `≈ ${fmtAmt(amt * sv + res.rewards * rv)} XLM ${fmtUsd(usd.ofXlm(amt * sv + res.rewards * rv))}` : ""}</span>
                  </>
                )}
              </CalcStat>
              <CalcStat label="APR incl. your stake" tone="cyan" testId="stake-apr">{pctStr(res.apr, 1)}<span className="calc-usd">pool now {pctStr(stakingApr(p.ratePerSec, p.totalStaked, 0, svr), 1)}{same ? "" : " (value-weighted)"}</span></CalcStat>
              <CalcStat label="Per day (while funded)"><TokenUsd amount={res.dailyReward} symbol={p.rewardSym} usd={usd.ofXlm(res.dailyReward * rv)} /></CalcStat>
              <CalcStat label="Your pool share">{pctStr(res.share, 3)}</CalcStat>
              <CalcStat label="Return on stake">{valueKnown && amt > 0 ? pctStr((res.rewards * rv) / (amt * sv), 2) : "—"}<span className="calc-usd">over {days} days</span></CalcStat>
            </div>
          </div>
          {!p.active && <div className="notice warn">This pool is inactive: it accepts no new stakes and emits no rewards.</div>}
          {res.payoutExceedsReserve && (
            <div className="notice calc-warn" role="alert" data-testid="stake-reserve-warning">
              ⚠ Your projected payout ({fmtAmt(res.uncapped)} {p.rewardSym}) exceeds the pool's entire remaining reward reserve ({fmtAmt(p.reserve)} {p.rewardSym}). The contract can only pay funded rewards.
            </div>
          )}
          {res.reserveDepletes && (
            <div className="notice warn" data-testid="stake-depletion-warning">
              The reward reserve runs dry after about <b>{fmtDays(res.runwayDays)}</b> at the current rate, before the end of your {days}-day horizon. After that emission stops until someone funds the pool, so the estimate is capped at {fmtAmt(res.rewards)} {p.rewardSym} (uncapped: {fmtAmt(res.uncapped)}).
            </div>
          )}
          {res.lockedAtEnd && <div className="notice warn">Duration is shorter than the {fmtD(p.lockDays)}-day lock: you could claim rewards, but not unstake, at the end.</div>}
          <ProjectionChart testId="stake-chart" series={series} markers={[...(res.reserveDepletes ? [{ x: res.runwayDays, label: "reserve empty", color: "#ff4d6d" }] : []), ...(p.lockDays > 0 && p.lockDays <= days ? [{ x: p.lockDays, label: "unlock", color: "#38f3ff" }] : [])]} />
          <ul className="calc-notes">
            <li>Rewards = pool emission × your share × time, where share = your stake / (staked by others + your stake). Assumes the rate and everyone else's stake stay as they are now; more stakers dilute you.</li>
            <li>Rewards are paid from a pre-funded reserve and are not re-staked automatically (no compounding).{same ? "" : ` APR compares reward value with stake value at current pool prices (1 ${p.rewardSym} ≈ ${fmtAmt(rv)} XLM).`}</li>
            <li>USD uses {usd.label}.</li>
          </ul>
          <CalcDisclaimer />
        </>
      )}
    </div>
  );
}
