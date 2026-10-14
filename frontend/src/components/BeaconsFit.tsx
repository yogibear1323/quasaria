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
        <p className="bp-fit-note" role="note">Testnet · unaudited. Beacons adds six new contracts on testnet. <b>QFX itself does not change.</b> Returns are not guaranteed.</p>

        <h3>The main gap: no protocol fee yet</h3>
        <p>Today the whole 0.3% swap fee goes to liquidity providers. Nothing goes to the protocol yet, so stakers have no fee source. The plan: add a small protocol share (about 5 of the 30 bps) to <i>new</i> testnet pools and send it to the fee router. Existing pools stay as they are. Lending and leverage fees can add to it too.</p>
        <p className="muted">To beat the 12% holder yield, Beacons needs about 808 XLM of fees a day per 1M QFX staked. At a 5 bps cut, that's about 1.6M XLM of daily swap volume.</p>

        <h3>What stays, what changes, what's new</h3>
        <div className="bp-fit-scroll"><table className="bp-fit-table">
          <thead><tr><th scope="col">DEX piece</th><th scope="col">Stays</th><th scope="col">Changes</th><th scope="col">New</th></tr></thead>
          <tbody>{ROWS.map(([a, b, c, d]) => <tr key={a}><th scope="row">{a}</th><td>{b}</td><td>{c}</td><td>{d}</td></tr>)}</tbody>
        </table></div>

        <h3>It sits beside Orbit and the 12% yield</h3>
        <ol>
          <li><b>Now:</b> Beacons runs on testnet next to Orbit. You choose: hold QFX (12%), use Orbit, or try Beacons (variable).</li>
          <li><b>After testing:</b> publish how Beacons compares with the holder yield and Orbit.</li>
          <li><b>Only if Beacons works:</b> stop adding new Orbit pools and lower the holder yield slowly, with notice.</li>
        </ol>

        <h3>Navigation</h3>
        <p>Find Beacons after Stake in the menu, and from the Stake, Earn and Back Office pages. On the world globe it's Beacon Heights.</p>

        <h3>Build order</h3>
        <ol className="bp-fit-cols">{BUILD.map((b) => <li key={b}>{b}</li>)}</ol>
        <p className="muted">Then 4–8 weeks of testing, an audit and a legal review. A small mainnet launch only happens with Robert's sign-off.</p>

        <h3>What the Back Office watches</h3>
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
        <p className="muted">Full plan, word for word: <a href="#doc-plan">DEX integration plan</a> in Full Beacons documents below, or <a href="https://github.com/yogibear1323/quasaria-beacons/blob/main/docs/dex-integration-plan.md" target="_blank" rel="noreferrer">docs/dex-integration-plan.md on GitHub</a>.</p>
      </div>
    </details>
  );
}
