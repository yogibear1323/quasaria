import { useState } from "react";
/** "How Beacons fits into Quasaria": the DEX integration plan (quasaria-beacons/dex-integration-plan.md) as a collapsed
 *  accordion on /beacons. Copy only; preview, nothing deployed. Native <details>/<summary> = keyboard + screen-reader accessible. */
const ROWS: [string, string, string, string][] = [
  ["Stake page / Orbit staking", "Contract, page and existing positions as-is", "Adds a Beacons (preview) link card: Orbit = pre-funded emissions, Beacons = revenue share", "Later: Beacons positions listed next to Orbit"],
  ["Earn", "All cards", "Adds a Beacons (preview) card linking here", "Beacons calculator = the simulator below"],
  ["QFX Mint & Rewards", "QFX contract unchanged", "Staked QFX leaves the wallet and stops earning the 12% holder yield (vault is yield-exempt, like Orbit)", "—"],
  ["Pools / LP fees", "Existing pools: 30 bps, 100% to LPs (minus referral cut)", "—", "New testnet pool generation with a protocol fee share sent to the fee router"],
  ["Referrals", "Contract", "Referral cut comes first (from the LP fee), then the protocol share", "Fee router can optionally fund the referral pool"],
  ["Quests / XP ranks", "All rules: XP is never money, no leaderboards", "—", "Constellations quest track: learn Beacons, run the simulator, stake once on testnet, claim a payout (cosmetic XP, not tied to deposit size)"],
  ["Back Office", "Beacons preview panel", "Links here; later fills the payout table from the indexer", "Monitoring tiles (below)"],
  ["Keepers", "Liquidations, oracle refresh", "Move to an always-on host", "Beacons keeper: 4-hour cycle, Blend supply/withdraw, unbonding queue, daily auto-claim"],
  ["Oracle / peg", "XLM/USD feed", "—", "Peg monitor reads QFX/XLM from the AMM QFX pools (TWAP) and QFX reserves"],
];
const BUILD = ["Protocol fee in the AMM (new pool wasm, timelocked)", "Fee router: 40 stakers / 10 insurance / 50 ops, multisig + timelock", "Insurance fund (10% of router + overflow)", "Beacon staking vault: tiers, lock boosts, 7-day unbonding, 2%/cycle exit cap, FIFO, warm-up", "Reward reserve / distributor: 1/42 per 4 h, 25% cap, 30-day overflow", "Blend adapter: XLM pool, 40% target (30–50%), emergency withdraw", "Peg monitor: pauses new stakes above 1% drift", "Keeper on an always-on host", "Indexer for payouts (/beacons and Back Office)", "Frontend wiring: live reads, stake / unbond / claim"];

const SEEN = "qz.beacons-fit-seen";
/** Open on a visitor's first visit so the section is noticed; remembers the user's own open/closed choice after that. */
function initialOpen(): boolean {
  try { const v = localStorage.getItem(SEEN); return v === null ? true : v === "open"; } catch { return true; }
}

export default function BeaconsFit() {
  const [open] = useState(initialOpen);
  return (
    <details id="how-beacons-fits" className="bp-fit card" open={open}
      onToggle={(e) => { try { localStorage.setItem(SEEN, (e.currentTarget as HTMLDetailsElement).open ? "open" : "closed"); } catch { /* private mode */ } }}>
      <summary><span className="bp-fit-t">How Beacons fits into Quasaria</span><span className="pill gold">Testnet · unaudited</span><span className="bp-fit-chev" aria-hidden="true">▾</span></summary>
      <div className="bp-fit-body">
        <p className="bp-fit-note" role="note">Testnet · unaudited. The six contracts are deployed on Stellar testnet only (see Live on testnet above), with <b>no change to the QFX contract</b>. Nothing here is a guaranteed return.</p>

        <h3>Key finding: no protocol fee share yet</h3>
        <p>Today the DEX's 0.3% swap fee goes entirely to liquidity providers (minus an optional referral cut). There is no protocol share, so the "40% of fees to stakers" has no source until one is added. Recommended: add a small protocol share (e.g. about 5 of the 30 bps) to <i>new</i> testnet pools and point it at the fee router; existing pools stay 100% to LPs. Lending treasury and a slice of leverage open fees can also flow to the router. Not recommended: taking 40% of gross swap fees from LPs.</p>
        <p className="muted">Honest scale: the 12% holder-yield break-even is about 808 XLM/day of fees entering the router per 1M QFX staked, roughly 1.6M XLM/day of swap volume per 1M QFX staked at a 5 bps protocol cut.</p>

        <h3>What stays, what changes, what's new</h3>
        <div className="bp-fit-scroll"><table className="bp-fit-table">
          <thead><tr><th scope="col">DEX piece</th><th scope="col">Stays</th><th scope="col">Changes</th><th scope="col">New</th></tr></thead>
          <tbody>{ROWS.map(([a, b, c, d]) => <tr key={a}><th scope="row">{a}</th><td>{b}</td><td>{c}</td><td>{d}</td></tr>)}</tbody>
        </table></div>

        <h3>Beside Orbit and the 12% holder yield, not replacing them</h3>
        <ol>
          <li><b>Now:</b> this preview page; testnet contracts built and soaked next to Orbit. Users choose: hold QFX (12% from the pre-funded reserve), Orbit pools, or Beacons (revenue share, variable).</li>
          <li><b>After the testnet soak:</b> publish Beacons APR vs holder yield vs Orbit, and the holder-yield reserve runway.</li>
          <li><b>Only if Beacons proves revenue-backed:</b> stop adding new Orbit pools (existing ones run out naturally) and phase the holder yield down in announced, timelocked steps. No QFX code change needed.</li>
        </ol>

        <h3>Navigation</h3>
        <p>Beacons sits right after Stake, labelled Preview. Entry points: the Stake page, the Earn hub and the Back Office Beacons panel. On the Quasaria world globe it's Beacon Heights.</p>

        <h3>Testnet build order (no deploys yet)</h3>
        <ol className="bp-fit-cols">{BUILD.map((b) => <li key={b}>{b}</li>)}</ol>
        <p className="muted">Then a 4–8 week soak, audit, legal review, hardware multisig, and a capped mainnet launch only with Robert's sign-off.</p>

        <h3>Back Office monitoring (with the testnet contracts)</h3>
        <ul className="bp-fit-cols">
          <li>Router inflow per source and protocol fee volume</li><li>Reserve vs 30-day threshold, cycles at the 25% cap</li><li>Blend deployed vs target, supply rate, liquidity</li>
          <li>Buffer vs queued exits, queue length and ETA</li><li>Peg drift vs 1% and pause state</li><li>Insurance vs 5% target; keeper heartbeat</li><li>Beacons APR vs holder yield vs Orbit APR</li>
        </ul>

        <h3>Open decisions</h3>
        <ol>
          <li>Add a protocol fee to new pools, and its size (e.g. 5 of 30 bps)?</li>
          <li>Confirm "40%" means 40% of the protocol share.</li>
          <li>Blend allocation 40%, or lower while Blend's XLM rate is near zero?</li>
          <li>Holder-yield phase-down timing (only after Beacons proves out).</li>
        </ol>
        <p className="muted">Full plan: <a href="https://github.com/yogibear1323/quasaria-beacons/blob/main/dex-integration-plan.md" target="_blank" rel="noreferrer">dex-integration-plan.md on GitHub</a>.</p>
      </div>
    </details>
  );
}
