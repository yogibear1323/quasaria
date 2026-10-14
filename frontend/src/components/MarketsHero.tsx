import { AssetLogo, Sparkline } from "./AssetBits";
import { fmt, fmtCompact } from "../lib/format";
import type { LiveRow } from "../lib/liveMarkets";

/** Markets summary: stats + top-movers strip, computed only from the rows already on the page (no invented data).
 *  Movers need a 24h change AND some 24h volume, so dead books with a stray quote can't top the list. */
/** Movers/gainer/loser only count assets with real activity (at least this much 24h volume, in XLM). */
export const MIN_VOL = 1000;

export default function MarketsHero({ rows, live, onPick }: { rows: LiveRow[]; live: boolean; onPick: (q: string) => void }) {
  const moving = rows.filter((r) => r.change24h !== null && Number.isFinite(r.change24h) && (r.volumeXlm24h ?? 0) >= MIN_VOL);
  const vol = rows.reduce((s, r) => s + (r.volumeXlm24h ?? 0), 0);
  const traded = rows.filter((r) => (r.volumeXlm24h ?? 0) > 0).length;
  const byChg = [...moving].sort((a, b) => (b.change24h as number) - (a.change24h as number));
  const up = byChg[0], dn = byChg[byChg.length - 1];
  const movers = [...moving].sort((a, b) => Math.abs(b.change24h as number) - Math.abs(a.change24h as number)).slice(0, 6);
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${fmt(v, 2)}%`;
  const loading = !rows.length;
  return (
    <section className="mk-hero" aria-label="Market summary">
      <div className="mk-hero-stats">
        <div className="mk-hs"><span className="mk-hs-l">Assets listed</span><b className="mk-hs-v">{loading ? <i className="mk-sk w60" /> : rows.length.toLocaleString()}</b><span className="mk-hs-s">top Stellar assets · 10 pages</span></div>
        <div className="mk-hs"><span className="mk-hs-l">24h volume</span><b className="mk-hs-v">{loading ? <i className="mk-sk w80" /> : `${fmtCompact(vol)} XLM`}</b><span className="mk-hs-s">{traded.toLocaleString()} assets traded{live ? "" : " · saved data"}</span></div>
        <div className="mk-hs"><span className="mk-hs-l">Top gainer 24h</span><b className="mk-hs-v">{up ? <><span>{up.code}</span> <span className="pos">{pct(up.change24h as number)}</span></> : loading ? <i className="mk-sk w80" /> : "—"}</b><span className="mk-hs-s">{up ? (up.orgName ?? up.homeDomain ?? "issuer unlisted") : `no asset with ≥ ${MIN_VOL.toLocaleString()} XLM vol`}</span></div>
        <div className="mk-hs"><span className="mk-hs-l">Top loser 24h</span><b className="mk-hs-v">{dn && dn !== up ? <><span>{dn.code}</span> <span className="neg">{pct(dn.change24h as number)}</span></> : loading ? <i className="mk-sk w80" /> : "—"}</b><span className="mk-hs-s">{dn && dn !== up ? (dn.orgName ?? dn.homeDomain ?? "issuer unlisted") : `no asset with ≥ ${MIN_VOL.toLocaleString()} XLM vol`}</span></div>
      </div>
      {movers.length > 0 && (
        <div className="mk-movers" aria-label="Top movers in the last 24 hours">
          <h2 className="mk-movers-h">Top movers · 24h <small>(≥ {MIN_VOL.toLocaleString()} XLM volume)</small></h2>
          <ul>
            {movers.map((r) => (
              <li key={r.key}>
                <button type="button" className="mk-mover" onClick={() => onPick(r.code)} title={`Filter the table to ${r.code}`}>
                  <span className="mk-mover-top"><AssetLogo code={r.code} logo={r.logo} size={28} /><span className="mk-mover-id"><b>{r.code}</b><small>{r.orgName ?? r.homeDomain ?? `${r.issuer.slice(0, 4)}…${r.issuer.slice(-4)}`}</small></span></span>
                  <span className="mk-mover-bot"><span className={(r.change24h as number) >= 0 ? "pos" : "neg"}>{pct(r.change24h as number)}</span>{r.sparkline.length > 1 ? <Sparkline values={r.sparkline} width={72} height={22} /> : <small className="muted">vol {fmtCompact(r.volumeXlm24h ?? 0)}</small>}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
