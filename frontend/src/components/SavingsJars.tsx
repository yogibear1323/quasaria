import { useCallback, useEffect, useState } from "react";
import { IS_MAINNET } from "../lib/config";
import { addr, i128, invokeContract, readContract } from "../lib/soroban";
import { addDeposit, allocated, jarStats, loadJars, newJar, reconcile, removeShares, saveJars, type Jar } from "../lib/jars";
import { toStroops, VAULT_ID } from "./YieldVaultCard";
import { TxStatus, useTx } from "./ui";

const x = (v: bigint) => (Number(v) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 4 });
const ICONS = ["🧊", "🏔️", "❄️", "🌨️", "⛷️", "🐾"];

/** Jar deposit amount check: > 0 and a valid 7-decimal number. NO cap for jars (owner decision). */
export function jarAmountProblem(s: string): string | null {
  if (!s.trim()) return "Enter an amount";
  const v = toStroops(s);
  if (v == null) return "Invalid amount (max 7 decimals)";
  if (v <= 0n) return "Amount must be above 0";
  return null;
}

export function SavingsJars() {
  const { status, busy, run, wallet: w } = useTx();
  const [jars, setJars] = useState<Jar[]>([]);
  const [price, setPrice] = useState<bigint>(10_000_000n);
  const [vaultShares, setVaultShares] = useState<bigint | null>(null);
  const [form, setForm] = useState({ name: "", target: "", date: "" });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [amt, setAmt] = useState<Record<string, string>>({});

  const persist = useCallback((next: Jar[]) => { if (w.address) saveJars(w.address, next); setJars(next); }, [w.address]);

  const refresh = useCallback(async () => {
    if (!w.address) { setJars([]); setVaultShares(null); return; }
    let js = loadJars(w.address);
    try {
      const [p, b] = await Promise.all([readContract<bigint>(VAULT_ID, "share_price"), readContract<bigint>(VAULT_ID, "balance", [addr(w.address)])]);
      setPrice(BigInt(p)); setVaultShares(BigInt(b));
      const r = reconcile(js, BigInt(b)); if (r !== js) { saveJars(w.address, r); js = r; }
    } catch { /* show stored jars even if the read fails */ }
    setJars(js);
  }, [w.address]);
  useEffect(() => { refresh(); }, [refresh]);

  const create = () => {
    setFormErr(null);
    try {
      const t = toStroops(form.target); if (t == null) throw new Error("Enter a target in XLM");
      persist([...jars, newJar(form.name, t, form.date || undefined)]); setForm({ name: "", target: "", date: "" });
    } catch (e) { setFormErr(e instanceof Error ? e.message : String(e)); }
  };
  const deposit = (j: Jar) => run(`Jar deposit (${j.name})`, async () => {
    const v = toStroops(amt[j.id] ?? ""); if (v == null || jarAmountProblem(amt[j.id] ?? "")) throw new Error("invalid amount");
    const r = await invokeContract(w.address!, w.sign, VAULT_ID, "deposit", [addr(w.address!), i128(v)]);
    const minted = BigInt(r.result as bigint);
    persist(loadJars(w.address!).map((k) => (k.id === j.id ? addDeposit(k, v, minted) : k)));
    setAmt((a) => ({ ...a, [j.id]: "" })); await refresh(); return r.hash;
  });
  const withdraw = (j: Jar) => run(`Jar withdraw (${j.name})`, async () => {
    const s = BigInt(j.shares); if (s <= 0n) throw new Error("This jar is empty");
    const r = await invokeContract(w.address!, w.sign, VAULT_ID, "withdraw", [addr(w.address!), i128(s)]);
    persist(loadJars(w.address!).map((k) => (k.id === j.id ? removeShares(k, s) : k)));
    await refresh(); return r.hash;
  });
  const remove = (j: Jar) => { if (BigInt(j.shares) > 0n) return; persist(jars.filter((k) => k.id !== j.id)); };

  if (!IS_MAINNET || !VAULT_ID) return null;
  const unallocated = vaultShares != null ? vaultShares - allocated(jars) : null;
  return (
    <section className="jars" data-testid="savings-jars">
      <div className="jars-head">
        <div><div className="vault-kicker">Organizer on top of your vault balance</div><h2>Savings Jars</h2></div>
      </div>
      <p className="jars-note" data-testid="jars-note">
        Jars are labels kept in this browser for this wallet. They split your Yield Vault shares into named goals; on-chain it's one vault balance.
        Jar deposits have no per-deposit cap. Yield sources aren't connected yet, so interest is 0% for now.
      </p>
      {!w.address ? <div className="notice">Sign in with your key to create jars.</div> : (
        <>
          <div className="jar-new card">
            <input className="input" placeholder="Jar name (e.g. Ski trip)" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" inputMode="decimal" placeholder="Target XLM" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            <input className="input" type="date" aria-label="Target date (optional)" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <button className="btn" data-testid="jar-create" onClick={create}>New jar</button>
            {formErr && <div className="muted neg" style={{ fontSize: "0.75rem" }}>{formErr}</div>}
          </div>
          {unallocated != null && unallocated > 0n && <div className="muted" style={{ fontSize: "0.75rem" }}>Unallocated vault balance: {x((unallocated * price) / 10_000_000n)} XLM</div>}
          <div className="jar-grid">
            {jars.map((j, i) => {
              const s = jarStats(j, price), p = jarAmountProblem(amt[j.id] ?? "");
              return (
                <div className={`jar card ${s.done ? "done" : ""}`} key={j.id} data-testid="jar">
                  <div className="jar-top"><span className="jar-ico" aria-hidden>{ICONS[i % ICONS.length]}</span><b>{j.name}</b>{j.date && <span className="muted jar-date">by {j.date}</span>}</div>
                  <div className="jar-bar" role="progressbar" aria-valuenow={s.pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${s.pct}%` }} /></div>
                  <div className="jar-stats">
                    <div><span>Value</span><b>{x(s.value)} / {x(BigInt(j.target))} XLM</b></div>
                    <div><span>Interest</span><b>{x(s.interest)} XLM · 0%</b></div>
                    <div><span>ETA</span><b>{s.eta}</b></div>
                    {s.perWeekNeeded != null && <div><span>To hit date</span><b>{x(s.perWeekNeeded)} XLM/week</b></div>}
                  </div>
                  <div className="jar-actions">
                    <input className="input" inputMode="decimal" placeholder="XLM" value={amt[j.id] ?? ""} onChange={(e) => setAmt({ ...amt, [j.id]: e.target.value })} />
                    <button className="btn small" disabled={busy || !!p} onClick={() => deposit(j)}>Deposit</button>
                    <button className="btn small ghost" disabled={busy || BigInt(j.shares) <= 0n} onClick={() => withdraw(j)}>Withdraw</button>
                    {BigInt(j.shares) === 0n && <button className="btn small ghost" onClick={() => remove(j)} title="Delete empty jar">✕</button>}
                  </div>
                </div>
              );
            })}
            {!jars.length && <div className="muted">No jars yet. Create one above.</div>}
          </div>
          <TxStatus status={status} />
        </>
      )}
    </section>
  );
}
