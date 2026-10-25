import { useCallback, useEffect, useState } from "react";
import data from "../config/rwa-mainnet.json";
import { IS_MAINNET } from "../lib/config";
import { addr, i128, invokeContract, readContract } from "../lib/soroban";
import { TxStatus, useTx } from "./ui";

/** Front-end per-deposit cap (XLM). The vault contract itself has NO on-chain cap. */
const STROOPS = 10_000_000n;
export const VAULT_ID = (data.contracts as { name: string; id?: string }[]).find((c) => c.name === "yield_vault")?.id ?? "";

/** Parse a decimal XLM string into stroops (7 dp), or null if invalid. */
export function toStroops(s: string): bigint | null {
  const m = /^\s*(\d+)(?:\.(\d{0,7}))?\s*$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * STROOPS + BigInt((m[2] ?? "").padEnd(7, "0") || "0");
}
const xlm = (v: bigint) => (Number(v) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 7 });

/** Deposit validity: >0, max 7 decimals (no deposit cap). */
export function depositProblem(s: string): string | null {
  if (!s.trim()) return "Enter an amount";
  const v = toStroops(s);
  if (v == null) return "Invalid amount (max 7 decimals)";
  if (v <= 0n) return "Amount must be above 0";
  return null;
}

export function YieldVaultCard() {
  const { status, busy, run, wallet: w } = useTx();
  const [amt, setAmt] = useState("");
  const [shares, setShares] = useState<bigint | null>(null);
  const [price, setPrice] = useState<bigint | null>(null);
  const [total, setTotal] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!VAULT_ID || !IS_MAINNET) return;
    try {
      setErr(null);
      const [p, t] = await Promise.all([readContract<bigint>(VAULT_ID, "share_price"), readContract<bigint>(VAULT_ID, "total_assets")]);
      setPrice(BigInt(p)); setTotal(BigInt(t));
      if (w.address) setShares(BigInt(await readContract<bigint>(VAULT_ID, "balance", [addr(w.address)])));
      else setShares(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [w.address]);
  useEffect(() => { refresh(); }, [refresh]);

  const problem = depositProblem(amt);
  const valueXlm = shares != null && price != null ? (shares * price) / STROOPS : null;

  const deposit = () => run("Vault deposit", async () => {
    const v = toStroops(amt);
    if (v == null || depositProblem(amt)) throw new Error(problem ?? "invalid amount");
    const r = await invokeContract(w.address!, w.sign, VAULT_ID, "deposit", [addr(w.address!), i128(v)]);
    setAmt(""); await refresh(); return r.hash;
  });
  const withdrawAll = () => run("Vault withdraw", async () => {
    if (!shares || shares <= 0n) throw new Error("No vault shares to withdraw");
    const r = await invokeContract(w.address!, w.sign, VAULT_ID, "withdraw", [addr(w.address!), i128(shares)]);
    await refresh(); return r.hash;
  });

  if (!IS_MAINNET || !VAULT_ID) return null;
  return (
    <div className="card vault-card" data-testid="yield-vault-card">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Deposit to Yield Vault</h2>
        <span className="pill green">MAINNET</span>
      </div>
      <div className="notice" role="alert" data-testid="vault-warning" style={{ margin: "10px 0" }}>
        Yield sources are not connected yet; withdrawals come from the vault's idle XLM.
      </div>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
        <div><div className="muted" style={{ fontSize: "0.75rem" }}>Your vault balance</div><b data-testid="vault-balance">{!w.address ? "Sign in to view" : valueXlm == null ? "…" : `${xlm(valueXlm)} XLM`}</b>{shares != null && <div className="muted" style={{ fontSize: "0.7rem" }}>{xlm(shares)} shares</div>}</div>
        <div><div className="muted" style={{ fontSize: "0.75rem" }}>Vault total</div><b>{total == null ? "…" : `${xlm(total)} XLM`}</b></div>
      </div>
      <label className="muted" style={{ fontSize: "0.75rem" }} htmlFor="vault-amt">Amount (XLM)</label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input id="vault-amt" className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ flex: "1 1 140px", minWidth: 0 }} />
        <button className="btn" data-testid="vault-deposit" disabled={!!problem || busy || !w.address} onClick={deposit}>Deposit</button>
        <button className="btn ghost" data-testid="vault-withdraw" disabled={busy || !w.address || !shares} onClick={withdrawAll}>Withdraw all</button>
      </div>
      {amt && problem && <div className="muted neg" style={{ fontSize: "0.75rem", marginTop: 6 }} data-testid="vault-problem">{problem}</div>}
      {!w.address && <div className="muted" style={{ fontSize: "0.75rem", marginTop: 6 }}>Sign in with your key to deposit.</div>}
      {err && <div className="muted" style={{ fontSize: "0.7rem", marginTop: 6 }}>Vault read failed: {err}</div>}
      <TxStatus status={status} />
    </div>
  );
}
