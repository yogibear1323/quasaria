/** Plain-language "Beacons in brief" summary for /beacons. Every fact comes from the Beacons docs
 *  (content/beacons-docs) and quasaria-beacons/deployments/testnet.json. Testnet · unaudited. */
const PARTS: [string, string][] = [
  ["Staking vault", "Holds your staked QFX. It puts 40% to work in Blend's XLM pool and keeps 60% as cash for exits."],
  ["Fee router", "Splits incoming fees: 40% to stakers, 10% to insurance, 50% to operations."],
  ["Reward reserve", "Collects the stakers' share and pays it out in XLM every 4 hours, smoothed over about 7 days."],
  ["Blend adapter", "Lends the vault's XLM to Blend, a lending protocol on Stellar, and brings it back for exits."],
  ["Insurance fund", "Covers Blend losses first, before they reach stakers."],
  ["Peg monitor", "Watches QFX against XLM. If they drift more than 1% apart, new stakes pause. Claims and exits keep working."],
];

export default function BeaconsSummary() {
  return (
    <section id="beacons-summary" className="card bp-sum" aria-labelledby="bp-sum-h">
      <h2 id="bp-sum-h">Beacons in brief</h2>
      <p>Beacons lets you stake QFX and earn a share of Quasaria's trading fees, paid in XLM every 4 hours. QFX is pegged 1:1 to XLM.</p>
      <ul className="bp-sum-list">
        <li><b>Six tiers, priced in QFX.</b> From Spark (100 QFX) to Singularity (250,000 QFX). Every QFX earns the same share. Higher tiers get bigger trading-fee discounts (up to 25%).</li>
        <li><b>Paid from real yield.</b> Payouts come from protocol fees and Blend lending interest, not from a pre-funded pot.</li>
        <li><b>Leaving takes 7 days.</b> Unstaking has a 7-day wait with no rewards. New stake starts earning after one 4-hour cycle.</li>
      </ul>
      <h3>What it's made of</h3>
      <dl className="bp-sum-parts">{PARTS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="bp-sum-note" role="note"><b>Testnet only.</b> The six contracts run on Stellar testnet, unaudited, with test XLM that has no value. Yields change and are not guaranteed. On testnet, fees come from a labelled test source because the DEX has no protocol fee share yet.</p>
    </section>
  );
}
