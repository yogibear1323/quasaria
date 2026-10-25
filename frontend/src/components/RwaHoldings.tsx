import { useEffect, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import data from "../config/rwa-mainnet.json";
import { readContract, addr } from "../lib/soroban";

const SC = "https://stellarchain.io";
const id = (n: string) => (data.contracts as { name: string; id: string }[]).find((c) => c.name === n)!.id;
export const WRAPPER_ID = id("rwa_wrapper");
export const POOL_ID = id("lending_pool");
export const VAULT = id("yield_vault");
export const ORACLE_ID = id("oracle_adapter");
/** Native XLM Stellar Asset Contract on mainnet: a wrapper over it is a placeholder, not a real-world asset. */
export const XLM_SAC = Asset.native().contractId("Public Global Stellar Network ; September 2015");
export const EMPTY_TEXT = "No real-world assets connected yet. Assets will appear here once added.";

export type RwaRow = { underlying: string; name: string; symbol: string; priceXlm: number | null; valueXlm: number; share: number; held?: number; link?: string; note?: string };
/** Etherfuse USTRY classic asset (issuer GCRYUG…MYWC), bought by the vault via its XLM→USDC→USTRY swap route. */
export const USTRY_ASSET = "USTRY-GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC";
export const USTRY_NOTE = "Issued by Etherfuse and backed by short-term US Treasury notes. Etherfuse, as issuer, can freeze or claw back USTRY tokens. The vault buys and sells it through a small on-chain pool, so each move in or out is limited in size.";
const NAV_MAX_AGE_S = 3600;
export type Live = { rwas: RwaRow[]; pool: { supplied: number; vaultSupplied: number; inPool: number }; totalAssets: number };

const X = (v: unknown) => Number(BigInt(String(v ?? 0))) / 1e7;

/** Only a wrapper whose underlying is NOT plain XLM counts as a real-world asset. */
export function isRealRwa(underlying: string) { return !!underlying && underlying !== XLM_SAC; }

export async function loadLive(read = readContract): Promise<Live> {
  const [pos, ta, und, poolSupply, vSup] = await Promise.all([
    read<unknown[]>(VAULT, "positions"), read(VAULT, "total_assets"), read<string>(WRAPPER_ID, "underlying"),
    read(POOL_ID, "total_supply"), read(POOL_ID, "vault_supplied"),
  ]);
  const totalAssets = X(ta);
  const rwas: RwaRow[] = [];
  if (isRealRwa(und)) {
    const [name, symbol, price] = await Promise.all([
      read<string>(und, "name").catch(() => "Unknown"), read<string>(und, "symbol").catch(() => "?"),
      read(ORACLE_ID, "collateral_price", [addr(und)]).then(X).catch(() => null),
    ]);
    const valueXlm = X(pos[2]);
    rwas.push({ underlying: und, name, symbol, priceXlm: price, valueXlm, share: totalAssets > 0 ? valueXlm / totalAssets : 0 });
  }
  const cfg = await read<{ ustry: string } | null>(VAULT, "swap_cfg").catch(() => null);
  if (cfg && cfg.ustry) {
    const [sp, nav] = await Promise.all([
      read<unknown[]>(VAULT, "rwa_swap_position").catch(() => ["0", "0", "0"]),
      read<{ price_xlm: unknown; ts: unknown } | null>(ORACLE_ID, "nav", [addr(cfg.ustry)]).catch(() => null),
    ]);
    const fresh = !!nav && Date.now() / 1000 - Number(nav.ts) <= NAV_MAX_AGE_S;
    const valueXlm = X(sp[2]);
    rwas.push({ underlying: cfg.ustry, name: "Etherfuse US Treasury", symbol: "USTRY", priceXlm: fresh ? X(nav!.price_xlm) : null,
      valueXlm, held: X(sp[0]), share: totalAssets > 0 ? valueXlm / totalAssets : 0, link: `${SC}/assets/${USTRY_ASSET}`, note: USTRY_NOTE });
  }
  return { rwas, pool: { supplied: X(poolSupply), vaultSupplied: X(vSup), inPool: X(pos[1]) }, totalAssets };
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function RwaHoldings({ load = loadLive, initial = null }: { load?: () => Promise<Live>; initial?: Live | null }) {
  const [live, setLive] = useState<Live | null>(initial);
  const [err, setErr] = useState(false);
  useEffect(() => { load().then(setLive).catch(() => setErr(true)); }, [load]);
  return (
    <section className="card vault-rwa" data-testid="rwa-holdings" style={{ marginTop: 16 }}>
      <h3>RWA holdings</h3>
      <p className="muted">Read live from the mainnet vault, price feed and lending pool contracts.</p>
      {err && <p className="muted" data-testid="rwa-error">Couldn't load live data from Stellar right now. Try again shortly.</p>}
      {!live && !err && <p className="muted">Loading live holdings…</p>}
      {live && (live.rwas.length === 0
        ? <p data-testid="rwa-empty">{EMPTY_TEXT}</p>
        : <div className="rwa-table">{live.rwas.map((r) => (
          <div key={r.underlying} className="rwa-row" data-testid="rwa-row">
            <b>{r.name} ({r.symbol})</b> <span className="muted">Tokenized real-world asset</span>
            <div>{r.link ? "Asset" : "Issuer contract"}: <a className="mono" href={r.link ?? `${SC}/contracts/${r.underlying}`} target="_blank" rel="noreferrer">{r.link ? r.symbol : `${r.underlying.slice(0, 6)}…${r.underlying.slice(-4)}`}</a></div>
            <div>Price: {r.priceXlm === null ? "no fresh price" : `${fmt(r.priceXlm)} XLM`} · Held: {r.held !== undefined ? `${fmt(r.held)} ${r.symbol} (${fmt(r.valueXlm)} XLM)` : `${fmt(r.valueXlm)} XLM`} · {pct(r.share)} of vault</div>
            {r.note && <p className="muted small" data-testid="rwa-note">{r.note}</p>}
          </div>))}</div>)}
      {live && (
        <div className="rwa-row" data-testid="pool-row" style={{ marginTop: 12 }}>
          <b>Lending pool (XLM)</b> <a className="mono" href={`${SC}/contracts/${POOL_ID}`} target="_blank" rel="noreferrer">{POOL_ID.slice(0, 6)}…{POOL_ID.slice(-4)}</a>
          <div>Supplied: {fmt(live.pool.supplied)} XLM · From vault: {fmt(live.pool.vaultSupplied)} XLM · {live.totalAssets > 0 ? pct(live.pool.inPool / live.totalAssets) : "0.00%"} of vault</div>
        </div>)}
      <p className="muted small">Wrapper contract: <a className="mono" href={`${SC}/contracts/${WRAPPER_ID}`} target="_blank" rel="noreferrer">{WRAPPER_ID.slice(0, 6)}…{WRAPPER_ID.slice(-4)}</a></p>
    </section>
  );
}
