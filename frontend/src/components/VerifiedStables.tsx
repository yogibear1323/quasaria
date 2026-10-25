import { useEffect, useState } from "react";
import { AssetLogo } from "./AssetBits";
import { explorerAssetUrl } from "../lib/explorer";
import { fmt } from "../lib/format";
import { fetchVerifiedStats, VERIFIED_ASSETS, VERIFIED_STABLE_AS_OF, type VerifiedStats } from "../lib/stablecoins";

/** Verified stablecoins + tokenized treasuries on Stellar (curated allowlist, live stats from Horizon). */
export default function VerifiedStables({ query, onExchange }: { query: string; onExchange: (key: string) => void }) {
  const [stats, setStats] = useState<Record<string, VerifiedStats | null | "err">>({});
  useEffect(() => {
    let alive = true;
    VERIFIED_ASSETS.forEach((a) => {
      const k = `${a.code}-${a.issuer}`;
      fetchVerifiedStats(a).then((s) => alive && setStats((m) => ({ ...m, [k]: s }))).catch(() => alive && setStats((m) => ({ ...m, [k]: "err" })));
    });
    return () => { alive = false; };
  }, []);
  const q = query.trim().toLowerCase();
  const rows = VERIFIED_ASSETS.filter((a) => !q || [a.code, a.issuer, a.name, a.org, a.domain, a.kind].some((s) => s.toLowerCase().includes(q)));
  return (
    <div data-testid="verified-stables">
      <div className="notice" style={{ fontSize: "0.82rem" }}>
        <b>Stablecoins &amp; Treasuries</b>: only Stellar mainnet assets whose issuer is verified, meaning the issuer account's home domain is the issuer's official site and its stellar.toml lists that exact code and issuer (checked {VERIFIED_STABLE_AS_OF}). Same-code lookalikes from other issuers are left out. Trustlines, supply and pools are live from public Horizon. Treasury tokens are tokenized government bonds or money funds, not stablecoins: their price moves with the fund's NAV and some are permissioned. Listing ≠ endorsement.
      </div>
      <div className="mk-scroll">
        <table className="t mk-table">
          <thead><tr><th>#</th><th>Asset</th><th>Type</th><th>Backing</th><th>Issuer</th><th>Trustlines</th><th>Supply (authorized)</th><th>Pools</th><th>Home domain</th><th /></tr></thead>
          <tbody>
            {rows.map((a, i) => {
              const k = `${a.code}-${a.issuer}`;
              const s = stats[k];
              const url = explorerAssetUrl(a.code, a.issuer, "mainnet");
              const v = (f: (x: VerifiedStats) => string) => (s === undefined ? "…" : s === null || s === "err" ? "—" : f(s));
              return (
                <tr key={k} data-testid="verified-row">
                  <td className="mono muted">{i + 1}</td>
                  <td><div className="row" style={{ gap: 8 }}><AssetLogo code={a.code} issuer={a.issuer} logo={a.logo} size={20} /><div><b>{a.code}</b><div className="muted" style={{ fontSize: "0.72rem" }}>{a.name} · {a.org}</div></div></div></td>
                  <td><span className="pill" style={{ fontSize: "0.7rem" }}>{a.kind}</span></td>
                  <td className="muted" style={{ fontSize: "0.72rem" }}>{a.peg}</td>
                  <td className="mono" style={{ fontSize: "0.72rem" }}>{url ? <a href={url} target="_blank" rel="noreferrer">{a.issuer.slice(0, 6)}…{a.issuer.slice(-4)}</a> : a.issuer}</td>
                  <td className="mono">{v((x) => x.trustlines.toLocaleString())}</td>
                  <td className="mono">{v((x) => fmt(Number(x.amount), 2))}</td>
                  <td className="mono">{v((x) => String(x.pools))}</td>
                  <td className="muted" style={{ fontSize: "0.72rem" }}>✓ {a.domain}</td>
                  <td><button className="btn small ghost" onClick={() => onExchange(k)}>Exchange</button></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={10} className="muted">No verified stablecoin or treasury token matches "{query}".</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
