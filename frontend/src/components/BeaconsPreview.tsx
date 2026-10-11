/** Quasaria Beacons — testnet preview. Layout only: no balances, rates or payouts exist yet, so none are shown. */
export const BEACON_TIERS = [
  { id: "spark", name: "Spark", lock: 100, weight: 1.0 },
  { id: "flare", name: "Flare", lock: 500, weight: 1.05 },
  { id: "beacon", name: "Beacon", lock: 2_500, weight: 1.1 },
  { id: "pulsar", name: "Pulsar", lock: 10_000, weight: 1.15 },
  { id: "quasar", name: "Quasar", lock: 50_000, weight: 1.2 },
  { id: "singularity", name: "Singularity", lock: 250_000, weight: 1.25 },
] as const;

export const PAYOUT_SOURCES = ["Trading fees · XLM/USDC", "Trading fees · other pairs", "Blend lending interest"] as const;

export function BeaconsPreview() {
  return (
    <section className="bk-preview" aria-label="Beacons preview">
      <div className="bk-preview-h">
        <h2>Beacons <span className="bk-chip bk-chip-preview">preview</span></h2>
        <span className="bk-chip bk-chip-notlive">Not live yet · testnet preview</span>
      </div>
      <p className="bk-tagline">Real light, not promised light.</p>
      <p className="bk-sub">
        Fee-share staking, planned. A Beacon will earn a share of real Quasaria trading fees plus Blend lending interest. The rate will be variable and shown as
        it happened, never promised. Nothing can be locked yet, so this panel has no balances and no rate.
      </p>
      <div className="bk-tiers" role="list" aria-label="Beacon tiers (proposed)">
        {BEACON_TIERS.map((t, i) => (
          <div key={t.id} role="listitem" className={`bk-tier t${i + 1}`}>
            <span className={`bk-tier-badge t${i + 1}`}><i aria-hidden="true" />{t.name}</span>
            <b>{t.lock.toLocaleString("en-US")} <small>XLM / QFX min.</small></b>
            <span className="bk-mut">share weight {t.weight.toFixed(2)}×</span>
            <span className="bk-mut">Holders: —</span>
          </div>
        ))}
      </div>
      <div className="bk-src">
        <span className="bo-lbl">Payout source breakdown · per 4-hour cycle</span>
        <div className="bk-src-tbl" role="table" aria-label="Payout source breakdown">
          <div className="bk-src-row hd" role="row"><span>Source</span><span>Amount</span><span>Share</span><span>On-chain tx</span></div>
          {PAYOUT_SOURCES.map((s) => (
            <div key={s} className="bk-src-row" role="row"><span>{s}</span><span>—</span><span>—</span><span className="bk-mut">no payouts yet</span></div>
          ))}
        </div>
        <p className="bk-empty">No payout cycles have run. When Beacons go live on testnet, every cycle will appear here with its source split and a link to each transaction, and its Beacon will pulse once when the payout lands.</p>
      </div>
      <p className="bo-fine">Proposed design, not an offer. Tier amounts are a draft. No expected or guaranteed returns.</p>
    </section>
  );
}
