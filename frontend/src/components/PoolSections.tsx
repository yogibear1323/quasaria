import { AssetLogo } from "./AssetBits";
import { XLM_LOGO } from "../lib/xlm";
import { useAsync } from "../lib/useAsync";
import { fmt, fmtCompact } from "../lib/format";
import { explorerAssetUrl } from "../lib/explorer";
import { curatedList, fetchPoolsByLookup, tvlUsd, verifyAsset, type AssetRef, type NetId, type PoolRow, type Pricing } from "../lib/nativePools";
import { VERIFIED_ASSETS, VERIFIED_STABLE_AS_OF, type VerifiedKind } from "../lib/stablecoins";

export type PoolSection = "other" | "treasury" | "stable";
/** ?section=treasury | stable; anything else (or none) = "Other assets", the default. */
export const sectionOf = (v: string | null): PoolSection => (v === "treasury" ? "treasury" : v === "stable" ? "stable" : "other");

const KIND: Record<Exclude<PoolSection, "other">, VerifiedKind> = { treasury: "Treasury", stable: "Stablecoin" };
/** A side is verified if it is XLM, on Quasaria's curated list, or on the verified stablecoin/treasury allowlist (code AND issuer). */
const sideOk = (net: NetId, a: AssetRef) => !a.issuer || verifyAsset(net, a).status === "verified" || VERIFIED_ASSETS.some((v) => v.code === a.code && v.issuer === a.issuer);
/** Official logo: Stellar for XLM, bundled verified logo, curated-list logo; otherwise null so AssetLogo shows its generic fallback. */
const logoFor = (net: NetId, a: AssetRef) => !a.issuer ? XLM_LOGO : VERIFIED_ASSETS.find((v) => v.code === a.code && v.issuer === a.issuer)?.logo ?? curatedList(net).find((c) => c.code === a.code && c.issuer === a.issuer)?.logo ?? null;
function PairIcons({ net, a, b }: { net: NetId; a: AssetRef; b: AssetRef }) {
  return (
    <span data-testid="pair-icons" style={{ display: "inline-flex", alignItems: "center", marginRight: 6, verticalAlign: "middle" }}>
      <span style={{ display: "inline-flex", zIndex: 1 }}><AssetLogo code={a.code} issuer={a.issuer} logo={logoFor(net, a)} size={20} /></span>
      <span style={{ display: "inline-flex", marginLeft: -7 }}><AssetLogo code={b.code} issuer={b.issuer} logo={logoFor(net, b)} size={20} /></span>
    </span>
  );
}
const amt = (n: number) => (n >= 1000 ? fmtCompact(n) : fmt(n, n < 1 ? 6 : 3));

/**
 * Real Stellar liquidity pools that contain a verified stablecoin / treasury token (matched by code AND issuer via Horizon).
 * Never invents pools, APY or TVL: when Horizon returns none, shows an honest empty state with the verified tokens.
 */
export default function PoolSections({ section, net, pricing, onOpen }: { section: Exclude<PoolSection, "other">; net: NetId; pricing: Pricing; onOpen: (lookup: string) => void }) {
  const assets = VERIFIED_ASSETS.filter((a) => a.kind === KIND[section]);
  const label = section === "treasury" ? "treasury bond" : "stablecoin";
  const res = useAsync(async () => {
    if (net !== "mainnet") return [] as { p: PoolRow; key: string }[];
    const seen = new Map<string, { p: PoolRow; key: string }>();
    const lists = await Promise.all(assets.map((a) => fetchPoolsByLookup(net, { kind: "asset", asset: { code: a.code, issuer: a.issuer } }).then((ps) => ps.map((p) => ({ p, key: `${a.code}-${a.issuer}` }))).catch(() => [])));
    lists.flat().forEach((x) => { if (x.p.reserveA > 0 && !seen.has(x.p.id)) seen.set(x.p.id, x); });
    return [...seen.values()];
  }, [section, net]);
  const all = [...(res.data ?? [])].sort((x, y) => (tvlUsd(y.p, pricing) ?? 0) - (tvlUsd(x.p, pricing) ?? 0) || y.p.holders - x.p.holders);
  const SHOW = 30;
  const rows = all.slice(0, SHOW);
  return (
    <div data-testid={`pool-section-${section}`}>
      <div className="notice" style={{ fontSize: "0.82rem" }}>
        <b>{section === "treasury" ? "Treasury bonds" : "Stablecoins"}</b>: Stellar mainnet liquidity pools that hold a verified {label} (issuer checked against its official stellar.toml, {VERIFIED_STABLE_AS_OF}), matched by code and issuer, never ticker alone. Reserves are live from public Horizon. {section === "treasury" ? "Treasury tokens track a fund's NAV and some are permissioned (only approved accounts can hold them)." : ""} Listing ≠ endorsement.
      </div>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table className="t" data-testid="section-pool-table">
          <thead><tr><th>Pair</th><th>TVL</th><th>Reserves</th><th>Providers</th><th /></tr></thead>
          <tbody>
            {res.loading && <tr><td colSpan={5} className="muted">Reading Horizon…</td></tr>}
            {!res.loading && !rows.length && <tr><td colSpan={5} className="muted" data-testid="section-empty">No {label} pools yet{net !== "mainnet" ? " on this network" : ""}. The verified {label} tokens are listed below; the first deposit into a pair creates its pool.</td></tr>}
            {rows.map(({ p, key }) => {
              const t = tvlUsd(p, pricing);
              return (
                <tr key={p.id} data-testid="section-pool-row" style={{ cursor: "pointer" }} onClick={() => onOpen(p.id)}>
                  <td><PairIcons net={net} a={p.a} b={p.b} /><b>{p.a.code}</b> <span className="muted">/</span> <b>{p.b.code}</b> {sideOk(net, p.a) && sideOk(net, p.b) ? <span className="pill green" style={{ fontSize: "0.55rem" }} title={key}>✔ both verified</span> : <span className="pill pink" style={{ fontSize: "0.55rem" }} title={key}>other side unverified</span>}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{t == null ? "—" : `$${fmtCompact(t)}`}</td>
                  <td className="mono muted" style={{ fontSize: "0.72rem" }}>{amt(p.reserveA)} {p.a.code} / {amt(p.reserveB)} {p.b.code}</td>
                  <td className="mono">{p.holders}</td>
                  <td><button className="btn small ghost">Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {all.length > SHOW && <p className="muted" style={{ fontSize: "0.76rem" }}>Showing the top {SHOW} of {all.length} pools by TVL. Use "Find pools" on a token below to see all pools for it.</p>}
      <h3 style={{ margin: "14px 0 6px" }}>Verified {label} tokens</h3>
      <div className="mk-scroll">
        <table className="t mk-table" data-testid="section-tokens">
          <thead><tr><th>Asset</th><th>Backing</th><th>Issuer</th><th>Home domain</th><th /></tr></thead>
          <tbody>
            {assets.map((a) => {
              const url = explorerAssetUrl(a.code, a.issuer, "mainnet");
              return (
                <tr key={`${a.code}-${a.issuer}`}>
                  <td><div className="row" style={{ gap: 8 }}><AssetLogo code={a.code} issuer={a.issuer} logo={a.logo} size={20} /><div><b>{a.code}</b><div className="muted" style={{ fontSize: "0.72rem" }}>{a.name} · {a.org}</div></div></div></td>
                  <td className="muted" style={{ fontSize: "0.72rem" }}>{a.peg}</td>
                  <td className="mono" style={{ fontSize: "0.72rem" }}>{url ? <a href={url} target="_blank" rel="noreferrer">{a.issuer.slice(0, 6)}…{a.issuer.slice(-4)}</a> : a.issuer}</td>
                  <td className="muted" style={{ fontSize: "0.72rem" }}>✓ {a.domain}</td>
                  <td><button className="btn small ghost" onClick={() => onOpen(`${a.code}-${a.issuer}`)}>Find pools</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
