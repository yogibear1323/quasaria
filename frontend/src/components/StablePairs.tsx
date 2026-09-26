import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import pairsDoc from "../../../docs/stablecoin-pairs.json";
import testnetStables from "../config/testnet-stablecoins.json";
import { AssetLogo } from "./AssetBits";
import { SourceTag } from "./ui";
import { useChain, readPool } from "../lib/chain";
import { fetchNativePool } from "../lib/stellar";
import { asOf } from "../lib/stellarchain";
import { expertContract } from "../lib/config";
import { fmt, fmtCompact } from "../lib/format";

type MainnetPair = (typeof pairsDoc.pairs)[number];
export type TestnetStable = {
  mainnetCode: string; code: string; issuer: string; assetKey: string; mock: boolean; label: string; peg: string; pxXlm: number;
  sac?: string; pool?: string; nativePoolId?: string; soroban?: { xlm: number; stable: number }; native?: { xlm: number; stable: number };
};
export type StableLive = { entry: TestnetStable; pair: MainnetPair; soroban: { reserveA: number; reserveB: number; totalShares: number; feeBps: number } | null; native: { reserveA: number; reserveB: number; totalShares: number; holders: number } | null };

const TESTNET: TestnetStable[] = ((testnetStables as { pools?: TestnetStable[] }).pools ?? []);

const verifyLabel = (p: MainnetPair) =>
  p.verification === "verified" ? "✔ toml-verified" : p.verification === "allowlisted" ? "✔ allowlisted (config)" : p.verification === "fetch-failed" ? "⚠ toml unreachable" : `⚠ ${p.verification}`;

export default function StablePairs({ onPick, picked }: { onPick: (l: StableLive) => void; picked?: string | null }) {
  const [showUnverified, setShowUnverified] = useState(false);
  const pairs = pairsDoc.pairs as MainnetPair[];
  const unverified = pairs.filter((p) => !p.verified);
  const visible = pairs.filter((p) => showUnverified || p.verified);

  const live = useChain(async () => {
    const rows = await Promise.all(
      TESTNET.map(async (e) => {
        const [s, n] = await Promise.all([e.pool ? readPool(e.pool).catch(() => null) : null, e.nativePoolId ? fetchNativePool(e.nativePoolId) : null]);
        return [e.mainnetCode, { soroban: s, native: n }] as const;
      }),
    );
    return Object.fromEntries(rows);
  }, []);

  const byCode = useMemo(() => Object.fromEntries(TESTNET.map((e) => [e.mainnetCode, e])), []);

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>XLM / stablecoin pairs <span className="muted" style={{ fontSize: "0.75rem", fontWeight: 400 }}>auto-generated</span></h2>
          <p className="muted" style={{ fontSize: "0.78rem", margin: "4px 0 0" }}>
            One pair per fiat-anchored stablecoin discovered in the stellarchain.io feed ({pairsDoc.scanned} assets scanned, snapshot as of {pairsDoc.asOf ? `${pairsDoc.asOf.slice(0, 10)} · ${asOf(pairsDoc.asOf)}` : "?"}), filtered (≥{pairsDoc.config.minTrustlines} holders, ≥{pairsDoc.config.minTrades24h} trades/24h, brand + deny rules) and issuer-verified against each home domain's stellar.toml. {pairsDoc.rejected.length} candidates rejected — see docs/stablecoin-pairs.json.
          </p>
        </div>
        <div className="row">
          <SourceTag {...live} />
          <label className="row" style={{ gap: 6, fontSize: "0.82rem" }}>
            <input type="checkbox" checked={showUnverified} onChange={(e) => setShowUnverified(e.target.checked)} /> Show unverified ({unverified.length})
          </label>
        </div>
      </div>
      {showUnverified && (
        <div className="risk" style={{ margin: "10px 0" }}>
          <strong>⚠ Unverified issuers shown.</strong> Their home domain's stellar.toml could not be fetched or does not list them. Anyone can issue an asset with any name — impostor "stablecoins" are common. Check the issuer address before trusting it.
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="t" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Pair</th><th>Peg</th><th>Issuer domain</th><th>Holders</th><th>Status</th>
              <th title="Read-only mainnet snapshot from Horizon">Mainnet native LP</th><th title="Read-only mainnet snapshot">Mainnet SDEX bid / ask</th>
              <th>Testnet asset</th><th>Soroban pool (testnet)</th><th>Native LP (testnet)</th><th />
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const e = p.primary ? byCode[p.code] : undefined;
              const l = e ? live.data?.[e.mainnetCode] : undefined;
              const m = p.mainnet as null | { nativePool: null | { reserveXlm: number; reserveStable: number; holders: number }; sdex: null | { bestBid: number | null; bestAsk: number | null } };
              return (
                <tr key={p.assetKey} style={{ outline: e?.pool && picked === e.pool ? "1px solid var(--quasar)" : undefined, opacity: p.verified ? 1 : 0.75 }}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <AssetLogo code={p.code} logo={p.logo && /^https:/.test(p.logo) ? p.logo : null} size={22} />
                      <div><b>XLM/{p.code}</b><div className="muted" style={{ fontSize: "0.68rem", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.org ?? `${p.issuer.slice(0, 4)}…${p.issuer.slice(-4)}`}</div></div>
                    </div>
                  </td>
                  <td className="mono">{p.peg}</td>
                  <td style={{ fontSize: "0.78rem" }}>{p.domain ? <a href={`https://${p.domain}`} target="_blank" rel="noreferrer">{p.domain}</a> : "—"}</td>
                  <td className="mono">{fmtCompact(p.holders)}</td>
                  <td style={{ fontSize: "0.72rem" }} className={p.verified ? "pos" : "neg"}>
                    {verifyLabel(p)}
                    {p.duplicate && <div className="muted">{p.primary ? "★ primary of duplicate code" : "duplicate code (not primary)"}</div>}
                  </td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>{m?.nativePool ? <>{fmtCompact(m.nativePool.reserveXlm)} XLM / {fmtCompact(m.nativePool.reserveStable)}<div className="muted">{m.nativePool.holders} LPs</div></> : <span className="muted">none</span>}</td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>{m?.sdex && (m.sdex.bestBid || m.sdex.bestAsk) ? `${m.sdex.bestBid ? fmt(m.sdex.bestBid, 4) : "—"} / ${m.sdex.bestAsk ? fmt(m.sdex.bestAsk, 4) : "—"}` : <span className="muted">no book</span>}</td>
                  <td style={{ fontSize: "0.75rem" }}>
                    {e ? <><span className={`pill ${e.mock ? "pink" : "green"}`} title={e.label}>{e.mock ? "MOCK" : "REAL"}</span> <span className="mono">{e.code}</span></> : <span className="muted">{p.primary ? "not seeded" : "—"}</span>}
                  </td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>
                    {e?.pool ? (l?.soroban ? <>{fmtCompact(l.soroban.reserveA)} / {fmtCompact(l.soroban.reserveB)}<div><a className="muted" href={expertContract(e.pool)} target="_blank" rel="noreferrer">{e.pool.slice(0, 5)}…{e.pool.slice(-4)}</a></div></> : live.loading ? "…" : "—") : "—"}
                  </td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>{e?.nativePoolId ? (l?.native ? <>{fmtCompact(l.native.reserveA)} / {fmtCompact(l.native.reserveB)}<div className="muted">{l.native.holders} LPs</div></> : live.loading ? "…" : "none") : "—"}</td>
                  <td>
                    {e?.pool && (
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn small ghost" disabled={!l?.soroban} onClick={() => l && onPick({ entry: e, pair: p, soroban: l.soroban, native: l.native })}>Liquidity</button>
                        <Link className="btn small ghost" to={`/trade?base=XLM&quote=${encodeURIComponent(e.assetKey)}`}>SDEX</Link>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.72rem" }}>
        Mainnet columns are a read-only Horizon snapshot taken when the list was generated ({pairsDoc.generatedAt.slice(0, 16).replace("T", " ")} UTC); Quasaria never trades on mainnet. Mainnet issuers don't exist on testnet, so testnet pairs use a real testnet stablecoin from the stellarchain testnet feed where one is tradeable (Circle's testnet USDC; testnet EURC had no sell-side liquidity) and clearly-labelled <b>MOCK</b> assets (code prefix "mk", issuer home_domain mock-stables.quasaria.invalid) otherwise. Source: stellarchain.io + issuer stellar.toml files.
      </p>
    </div>
  );
}
