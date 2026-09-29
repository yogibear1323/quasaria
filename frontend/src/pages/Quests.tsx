import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { useGame } from "../game/GameProvider";
import BadgeIcon from "../game/BadgeIcon";
import { AnimatedNumber, Flame, LevelHex, RankLadder, SoundToggle, XP_NOTE, XpBar, questProgress } from "../game/widgets";
import { BADGES, DAILY_XP, QUESTS, type QuestKind } from "../game/engine";

const GROUPS: { kind: QuestKind; title: string; blurb: string }[] = [
  { kind: "learn", title: "Learn", blurb: "Understand the risks and the tools. These are worth the most XP." },
  { kind: "try", title: "Try it once", blurb: "One-time only, any amount of free testnet tokens. Repeating an action or using bigger amounts earns nothing." },
  { kind: "habit", title: "Habits", blurb: `Check in on consecutive days. Each new day also gives +${DAILY_XP} XP.` },
];

const RISKS: { t: string; d: string }[] = [
  { t: "Testnet only", d: "Quasaria runs on Stellar testnet during the beta. Testnet tokens are free and have no real value; the network can be reset at any time." },
  { t: "Unaudited software", d: "The Soroban contracts have not been audited. Bugs can lock or lose funds. Never treat testnet behaviour as a guarantee for mainnet." },
  { t: "Leverage can liquidate you", d: "Leverage multiplies losses as well as gains. At 5× a 20% move against you can wipe out your margin, and positions are liquidated when the health factor drops below 1.0." },
  { t: "Impermanent loss", d: "Liquidity providers can end up with less value than simply holding when prices move apart. Fees may or may not make up for it." },
  { t: "Rewards come from finite reserves", d: "Staking and QFX holder rewards are paid from pre-funded reserves. When a reserve runs dry, rewards stop, so today's APR is not a promise." },
  { t: "Slippage & price impact", d: "Large swaps against thin pools move the price. Set a max slippage so a swap fails instead of filling at a bad rate." },
  { t: "Your keys, your responsibility", d: "Quasaria never sees your secret key. If you lose it, nobody can recover the account. Back it up offline." },
  { t: "Not financial advice", d: "Nothing in Quasaria is financial advice. Leveraged and yield products may be regulated or restricted where you live." },
];

/** /quests — mission control: level, streak, quests, badges and the risk guide. Purely cosmetic, stored locally. */
export default function Quests() {
  const g = useGame();
  if (!g) return null;
  const { state, info } = g;
  const doneCount = QUESTS.filter((q) => state.done[q.id]).length;
  const badgeCount = BADGES.filter((b) => state.badges[b.id]).length;
  return (
    <>
      <PageHead kicker="Mission control" title="Quests" right={<span className="pill cyan">Stored in this browser · {g.owner ? `wallet ${g.owner.slice(0, 4)}…${g.owner.slice(-4)}` : "guest (connect a wallet to save per address)"}</span>}>
        Learn how Quasaria works, try each feature once on testnet and build safe habits. XP rewards understanding, never money.
      </PageHead>

      <div className="notice xp-disclaimer" role="note"><b>XP is not money.</b> {XP_NOTE} There are no leaderboards, and nothing here rewards trade volume, leverage or deposit size.</div>

      <div className="grid g-main-side" style={{ marginBottom: 16 }}>
        <div className="card glow q-profile" data-testid="quest-profile">
          <div className="q-prof-top">
            <LevelHex level={info.level} size={76} />
            <div className="q-prof-main">
              <div className="q-prof-kicker">Level {info.level}</div>
              <div className="q-prof-rank grad-text">{info.rank}</div>
              <div className="muted"><b className="mono" style={{ color: "var(--text)" }}><AnimatedNumber value={info.xp} /></b> XP{info.next !== null ? <> · <AnimatedNumber value={info.next - info.xp} /> XP to level {info.level + 1}</> : " · max level reached"}</div>
            </div>
            <div className="q-prof-stats">
              <div><b className="mono"><AnimatedNumber value={doneCount} /></b><span className="muted">/{QUESTS.length} quests</span></div>
              <div><b className="mono"><AnimatedNumber value={badgeCount} /></b><span className="muted">/{BADGES.length} badges</span></div>
            </div>
          </div>
          <XpBar progress={info.progress} big />
          <RankLadder level={info.level} />
        </div>
        <div className="card q-streak" data-testid="quest-streak">
          <h2><Flame size={18} /> Visit streak</h2>
          <div className="q-streak-n"><AnimatedNumber value={state.streak.count} /><small>day{state.streak.count === 1 ? "" : "s"}</small></div>
          <div className="q-week" aria-label={`${Math.min(state.streak.count, 7)} of 7 days`}>
            {Array.from({ length: 7 }, (_, i) => <span key={i} className={i < Math.min(state.streak.count, 7) ? "on" : ""} />)}
          </div>
          <p className="muted l-tiny">Best streak: {state.streak.best} day{state.streak.best === 1 ? "" : "s"}. Come back tomorrow to keep it alive; missing a day just starts a new streak.</p>
          <div className="row between" style={{ marginTop: "auto", flexWrap: "wrap" }}>
            <SoundToggle />
            <button className="btn small ghost" onClick={() => { if (window.confirm("Reset XP, quests and badges for this wallet in this browser?")) g.reset(); }}>Reset progress</button>
          </div>
        </div>
      </div>

      <div className="grid g-main-side">
        <div className="card" data-testid="quest-list">
          <h2>Quests</h2>
          {GROUPS.map((grp) => (
            <section key={grp.kind} className="q-group">
              <div className="q-group-h"><h3>{grp.title}</h3><span className="muted l-tiny">{grp.blurb}</span></div>
              <ul className="q-list">
                {QUESTS.filter((q) => q.kind === grp.kind).map((q) => {
                  const ok = !!state.done[q.id];
                  const prog = questProgress(state, q);
                  return (
                    <li key={q.id} className={`q-item ${ok ? "done" : ""}`}>
                      <span className="q-check" aria-hidden>{ok ? <svg viewBox="0 0 16 16" width="14" height="14"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}</span>
                      <div className="q-body">
                        <div className="q-title">{q.title}<span className="sr-only">{ok ? " (complete)" : " (not yet complete)"}</span></div>
                        <div className="muted q-desc">{q.desc}</div>
                        {prog && !ok && <div className="q-prog"><XpBar progress={prog[0] / prog[1]} /><span className="mono l-tiny muted">{prog[0]}/{prog[1]}</span></div>}
                      </div>
                      <span className={`xp-chip ${ok ? "got" : ""}`}>+{q.xp} XP</span>
                      {!ok && q.to && <Link className="btn small ghost q-go" to={q.to}>{q.cta ?? "Go"}</Link>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card" data-testid="badge-grid">
            <h2>Badges <span className="muted l-tiny" style={{ fontFamily: "var(--font-body)" }}>{badgeCount}/{BADGES.length}</span></h2>
            <div className="badge-grid">
              {BADGES.map((b) => {
                const on = !!state.badges[b.id];
                return (
                  <div key={b.id} className={`badge-cell ${on ? "on" : ""}`} title={`${b.name}: ${b.desc}${on ? "" : " (locked)"}`}>
                    <BadgeIcon badge={b} unlocked={on} size={56} />
                    <b>{b.name}</b>
                    <span className="muted">{on ? b.desc : "Locked"}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card q-how">
            <h2>How XP works</h2>
            <ul className="calc-notes" style={{ margin: 0 }}>
              <li>Rewards <b>learning and safe habits</b>: the risk guide, calculators, a slippage guard, daily check-ins.</li>
              <li>On-chain quests count <b>once</b>, for any amount. Volume, trade count, leverage and deposit size never earn XP.</li>
              <li>No leaderboards and no rankings by money.</li>
              <li>Progress is saved per wallet address in this browser's localStorage only.</li>
            </ul>
          </div>
        </div>
      </div>

      <section id="risk-guide" className="card q-risk" style={{ marginTop: 16, scrollMarginTop: 90 }} data-testid="risk-guide">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="kicker q-risk-k">Risk guide</div>
            <h2 style={{ fontSize: "1.35rem", margin: "4px 0 0" }}>Before you trade, know the risks</h2>
          </div>
          <span className="xp-chip">{state.done["risk-guide"] ? "✓ Read" : "+100 XP"}</span>
        </div>
        <div className="q-risk-grid">
          {RISKS.map((r, i) => (
            <div key={r.t} className="q-risk-item">
              <span className="q-risk-n mono">{String(i + 1).padStart(2, "0")}</span>
              <div><b>{r.t}</b><p className="muted">{r.d}</p></div>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn" disabled={!!state.done["risk-guide"]} onClick={() => g.completeQuest("risk-guide")} data-testid="risk-guide-ack">
            {state.done["risk-guide"] ? "✓ Risk guide read" : "I've read and understood this"}
          </button>
          <span className="muted l-tiny">Quasaria is an unaudited, testnet-only scaffold. Nothing here is financial advice.</span>
        </div>
      </section>
    </>
  );
}
