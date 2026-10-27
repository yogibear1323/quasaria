import { useCallback, useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { HORIZON_URL, IS_MAINNET, NETWORK, NETWORK_PASSPHRASE } from "../lib/config";
import { addr, i128, invokeContract, readContract } from "../lib/soroban";
import { fetchBaseReserve, fetchRawAccount, type HAccount } from "../lib/account";
import { findStrictSendPath, horizon, submitSignedXdr } from "../lib/stellar";
import { buildSwapTx, checkSwapFunds, parseQuote, parseSwapReceived, plainSwapError } from "../lib/swap";
import { loadFeeReceiver, planFees, type FeeLine } from "../lib/fees";
import { explorerTxUrl, explorerAssetUrl } from "../lib/explorer";
import {
  SCALE, allocation, closeJar, createJar, deposit, fmt7, jarView, loadLedger, moveUnits, renameJar, resolveShortfall, saveLedger, toUnits, toUnitsN, withdraw,
  type Holding, type Jar, type Ledger,
} from "../lib/jarsLedger";
import { isStale, loadJarPrices, type JarPrices } from "../lib/jarsPrice";
import { JAR_DEFAULT_SLIPPAGE, JAR_MAX_SLIPPAGE, USTRY, USTRY_REF, planJarSwap, type JarSwapPlan } from "../lib/jarsSwap";
import { JAR_SYNC_ENABLED } from "../lib/jarsSync";
import { JarSync } from "./JarSync";
import { toStroops, VAULT_ID } from "./YieldVaultCard";
import { FeeRow } from "./FeeRow";
import { TxStatus, useTx } from "./ui";

const ICONS = ["🧊", "🏔️", "❄️", "🌨️", "⛷️", "🐾"];
const usd = (v: bigint | null) => (v === null ? "—" : (Number(v) / 1e7).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const signedUsd = (v: bigint | null) => (v === null ? "—" : `${v >= 0n ? "+" : "−"}${usd(v < 0n ? -v : v)}`);
const n = (v: number, d = 7) => v.toLocaleString("en-US", { maximumFractionDigits: d });
const age = (at: number | undefined) => { if (!at) return "unknown"; const m = Math.round((Date.now() - at) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const usdUnits = (p: number | null | undefined) => (p && p > 0 ? toUnitsN(p) : null);

/** Jar deposit amount check: > 0 and a valid 7-decimal number. NO cap for jars (owner decision). */
export function jarAmountProblem(s: string): string | null {
  if (!s.trim()) return "Enter an amount";
  const v = toStroops(s);
  if (v == null) return "Invalid amount (max 7 decimals)";
  if (v <= 0n) return "Amount must be above 0";
  return null;
}

type Review = { jar: Jar; amount: number; plan: Extract<JarSwapPlan, { ok: true }>; needTrust: boolean; feeXlm: number; reserveXlm: number; fees: FeeLine[] };

export function SavingsJars() {
  const { status, busy, run, wallet: w } = useTx();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [prices, setPrices] = useState<JarPrices>({ ustry: null, xlmUsd: null });
  const [acct, setAcct] = useState<HAccount | null>(null);
  const [vault, setVault] = useState<{ shares: bigint; price: bigint } | null>(null);
  const [form, setForm] = useState({ name: "", fund: "XLM" as "XLM" | "USTRY", target: "", date: "" });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, "history" | "move" | "rename" | undefined>>({});
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [slip, setSlip] = useState(JAR_DEFAULT_SLIPPAGE);
  const [absorb, setAbsorb] = useState("");

  const persist = useCallback((next: Ledger) => { if (w.address) saveLedger(w.address, next); setLedger(next); }, [w.address]);

  const refresh = useCallback(async () => {
    if (!w.address) { setLedger(null); return; }
    let l = loadLedger(w.address);
    if (!localStorage.getItem(`quasaria.jars.v2.${w.address}`)) saveLedger(w.address, l); // persist migration once
    const [a, p] = await Promise.all([fetchRawAccount(NETWORK, w.address).catch(() => null), loadJarPrices()]);
    setAcct(a); setPrices(p);
    if (VAULT_ID && l.jars.some((j) => j.holding === "VAULT")) {
      try {
        const [sp, b] = await Promise.all([readContract<bigint>(VAULT_ID, "share_price"), readContract<bigint>(VAULT_ID, "balance", [addr(w.address)])]);
        setVault({ shares: BigInt(b), price: BigInt(sp) });
        const r = resolveShortfall(l, "VAULT", BigInt(b)); // legacy behavior: vault jars auto-reconcile
        if (r !== l) { saveLedger(w.address, r); l = r; }
      } catch { /* keep stored jars */ }
    }
    setLedger(l);
  }, [w.address]);
  useEffect(() => { refresh(); }, [refresh]);

  const ustryBal = useMemo(() => {
    const b = acct?.balances.find((x) => x.asset_code === USTRY_REF.code && x.asset_issuer === USTRY_REF.issuer);
    return b ? toUnits(Number(b.balance).toFixed(7)) ?? 0n : null;
  }, [acct]);
  const ustryUsd = usdUnits(prices.ustry?.usd);
  const xlmUsd = usdUnits(prices.xlmUsd?.price);
  const vaultUsdPerShare = vault && xlmUsd ? (vault.price * xlmUsd) / SCALE : null;
  const priceOf = (h: Holding) => (h === "USTRY" ? ustryUsd : vaultUsdPerShare);
  const stale = isStale(prices.ustry?.at) || isStale(prices.xlmUsd?.at);

  const act = (f: () => Ledger) => { setMsg(null); try { persist(f()); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };

  const create = () => {
    setFormErr(null);
    try {
      const t = form.target.trim() ? toUnits(form.target) : undefined;
      if (t === null) throw new Error("Target must be a dollar amount");
      persist(createJar(ledger!, { name: form.name, fund: form.fund, targetUsd: t, date: form.date || undefined }));
      setForm({ ...form, name: "", target: "", date: "" });
    } catch (e) { setFormErr(e instanceof Error ? e.message : String(e)); }
  };

  /** USTRY-funded: earmark USTRY already in the wallet (Unassigned). No transaction. */
  const assign = (j: Jar) => act(() => {
    const u = toUnits(amt[j.id] ?? ""); if (!u || u <= 0n) throw new Error("Enter a USTRY amount");
    if (ustryBal === null) throw new Error("Your wallet has no USTRY trustline yet. Add USTRY on the Swap page, or fund this Snowbank with XLM.");
    const { unassigned } = allocation(ledger!, "USTRY", ustryBal);
    if (u > unassigned) throw new Error(`Only ${fmt7(unassigned)} USTRY is unassigned in your wallet.`);
    if (!ustryUsd || isStale(prices.ustry?.at)) throw new Error("USTRY price is stale; try again when it refreshes.");
    setAmt((a) => ({ ...a, [j.id]: "" }));
    return deposit(ledger!, j.id, { units: u, usd: (u * ustryUsd) / SCALE, type: "assign" });
  });

  /** XLM-funded: quote + checks, then show the review panel. Nothing is signed here. */
  const startSwap = async (j: Jar) => {
    setMsg(null); setReview(null);
    const amount = Number(amt[j.id]); const p = jarAmountProblem(amt[j.id] ?? "");
    if (p) return setMsg(p);
    if (stale) return setMsg("Prices are stale, so swaps are paused. Try again in a moment.");
    try {
      const [a, reserve, rec] = await Promise.all([fetchRawAccount(NETWORK, w.address!), fetchBaseReserve(NETWORK), findStrictSendPath(Asset.native(), amount, USTRY)]);
      const fees = planFees([{ asset: Asset.native(), amount }], await loadFeeReceiver(HORIZON_URL));
      const feeTotal = fees.reduce((s, l) => s + l.amount, 0);
      const f = checkSwapFunds({ from: { code: "XLM", issuer: null }, to: USTRY_REF, amount: amount + feeTotal, acct: a, baseReserve: reserve, extraOps: fees.length });
      if (!f.ok) return setMsg(f.error);
      const plan = planJarSwap({ quote: parseQuote(amount, rec as never), slippage: slip, xlmUsd: prices.xlmUsd?.price ?? null, ustryUsd: prices.ustry?.usd ?? null });
      if (!plan.ok) return setMsg(plan.error);
      setReview({ jar: j, amount, plan, needTrust: f.needTrust.length > 0, feeXlm: f.feeXlm, reserveXlm: f.reserveXlm, fees });
    } catch (e) { setMsg(`Could not get a quote: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const confirmSwap = () => { const r = review!; return run(`Snowbank deposit (${r.jar.name}): swap ${n(r.amount)} XLM → USTRY`, async () => {
    try {
      const seq = (await horizon.loadAccount(w.address!)).sequenceNumber();
      const xdr = buildSwapTx({ source: w.address!, sequence: seq, from: Asset.native(), to: USTRY, amount: r.amount, minOut: r.plan.minOut, path: r.plan.quote.path, needTrust: r.needTrust ? [USTRY] : [], passphrase: NETWORK_PASSPHRASE, fees: r.fees });
      const res = await submitSignedXdr(await w.sign(xdr));
      const got = parseSwapReceived(res.result_xdr) ?? r.plan.minOut;
      const xlmSpent = r.amount + r.fees.reduce((s, l) => s + l.amount, 0);
      const cost = xlmUsd ? (toUnitsN(xlmSpent) * xlmUsd) / SCALE : 0n;
      persist(deposit(loadLedger(w.address!), r.jar.id, { units: toUnitsN(got), usd: cost, xlm: toUnitsN(xlmSpent), tx: res.hash }));
      setReview(null); setAmt((a) => ({ ...a, [r.jar.id]: "" })); await refresh();
      return res.hash;
    } catch (e) { setReview(null); throw new Error(plainSwapError(e)); }
  }); };

  const release = (j: Jar) => act(() => {
    const u = amt[j.id]?.trim() ? toUnits(amt[j.id]) : BigInt(j.units);
    if (!u || u <= 0n) throw new Error("Enter an amount to release");
    setAmt((a) => ({ ...a, [j.id]: "" }));
    return withdraw(ledger!, j.id, u);
  });
  const vaultWithdraw = (j: Jar) => run(`Snowbank withdraw (${j.name})`, async () => {
    const s = BigInt(j.units); if (s <= 0n) throw new Error("This Snowbank is empty");
    const r = await invokeContract(w.address!, w.sign, VAULT_ID, "withdraw", [addr(w.address!), i128(s)]);
    persist(withdraw(loadLedger(w.address!), j.id, s, r.hash)); await refresh(); return r.hash;
  });
  const move = (j: Jar) => act(() => {
    const to = moveTo[j.id]; if (!to) throw new Error("Pick a Snowbank to move to");
    const u = amt[j.id]?.trim() ? toUnits(amt[j.id]) : BigInt(j.units);
    if (!u) throw new Error("Enter an amount");
    setOpen((o) => ({ ...o, [j.id]: undefined })); setAmt((a) => ({ ...a, [j.id]: "" }));
    return moveUnits(ledger!, j.id, to, u);
  });

  if (!IS_MAINNET) return null;
  const jars = ledger?.jars ?? [];
  const ustryAlloc = ustryBal !== null && ledger ? allocation(ledger, "USTRY", ustryBal) : null;
  const totals = (h: Holding) => jars.filter((j) => j.holding === h).reduce((a, j) => { const v = jarView(j, priceOf(h)); return { units: a.units + BigInt(j.units), value: v.valueUsd === null || a.value === null ? null : a.value + v.valueUsd, cost: a.cost + BigInt(j.costUsd) }; }, { units: 0n, value: 0n as bigint | null, cost: 0n });
  const tU = totals("USTRY"), tV = totals("VAULT");
  const unassignedUsd = ustryAlloc && ustryUsd ? (ustryAlloc.unassigned * ustryUsd) / SCALE : null;
  const combined = tU.value !== null && (tV.units === 0n || tV.value !== null) ? tU.value + (tV.value ?? 0n) : null;
  const rate = prices.ustry?.ratePct;

  return (
    <section className="jars" data-testid="savings-jars">
      <div className="jars-head">
        <div><div className="vault-kicker">Goals on top of USTRY in your own wallet</div><h2>Snowbanks</h2></div>
        <div className="jar-badges">
          <span className="pill" data-testid="jar-rate">{rate != null ? `Etherfuse USTRY rate now: ${rate.toFixed(2)}% APY · variable, reset weekly` : "USTRY rate unavailable"}</span>
          <span className={`pill ${stale ? "neg" : ""}`} data-testid="jar-price-age">{stale ? "Stale price" : "Price"} · {age(prices.ustry?.at)}</span>
        </div>
      </div>
      <p className="jars-note" data-testid="jars-note">
        Each Snowbank holds USTRY, Etherfuse's tokenized US Treasury bill. Its value comes from USTRY's dollar price rising, which compounds on its own, so every Snowbank grows independently. The rate changes weekly and isn't guaranteed; on weekends the price can sit flat.
        Fund a Snowbank with USTRY you already hold, or with XLM that gets swapped into USTRY when you deposit (you review the quote and sign). Snowbanks are labels in this browser: the USTRY stays in your wallet and can still be spent elsewhere. Etherfuse can freeze or claw back USTRY.
        {JAR_SYNC_ENABLED ? " Snowbanks are saved on this device; turn on sync below to carry them to your other devices (optional, encrypted, you sign each sync)." : " Snowbanks are saved on this device for now; cross-device sync is coming."}
      </p>
      {!w.address ? <div className="notice">Sign in with your key to create Snowbanks.</div> : !ledger ? <div className="muted">Loading Snowbanks…</div> : (
        <>
          <div className="jar-totals card" data-testid="jar-totals">
            <div><span>All Snowbanks</span><b>{usd(combined)}</b></div>
            <div><span>USTRY Snowbanks</span><b>{usd(tU.value)}</b><small className="muted">{fmt7(tU.units)} USTRY · gain {signedUsd(tU.value === null ? null : tU.value - tU.cost)}</small></div>
            {tV.units > 0n && <div><span>Old vault Snowbanks</span><b>{usd(tV.value)}</b><small className="muted">0% yield until vault allocation</small></div>}
            <div data-testid="jar-unassigned"><span>Unassigned USTRY</span><b>{usd(unassignedUsd)}</b><small className="muted">{ustryBal === null ? "No USTRY trustline yet" : `${fmt7(ustryAlloc!.unassigned)} USTRY in wallet, not in a Snowbank`}</small></div>
          </div>

          {JAR_SYNC_ENABLED && <JarSync address={w.address} acct={acct} ledger={ledger} persist={persist} sign={w.sign} refresh={refresh} />}

          {ustryAlloc && ustryAlloc.shortfall > 0n && (
            <div className="notice jar-shortfall" data-testid="jar-shortfall" role="alert">
              <b>Your wallet holds {fmt7(ustryAlloc.wallet)} USTRY, but your Snowbanks add up to {fmt7(ustryAlloc.allocated)}.</b> Short by {fmt7(ustryAlloc.shortfall)} USTRY (spent or moved outside Quasaria).
              Add USTRY back, or choose how Snowbanks absorb it:
              <div className="jar-actions" style={{ marginTop: 8 }}>
                <select className="input" value={absorb} onChange={(e) => setAbsorb(e.target.value)} aria-label="Snowbank that absorbs the shortfall">
                  <option value="">Scale every Snowbank down evenly</option>
                  {jars.filter((j) => j.holding === "USTRY" && BigInt(j.units) > 0n).map((j) => <option key={j.id} value={j.id}>Take it from {j.name} first</option>)}
                </select>
                <button className="btn small" data-testid="jar-shortfall-apply" onClick={() => act(() => resolveShortfall(ledger, "USTRY", ustryAlloc.wallet, absorb || undefined))}>Apply</button>
              </div>
            </div>
          )}

          <div className="jar-new card">
            <input className="input" placeholder="Snowbank name (e.g. Ski trip)" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="seg" role="radiogroup" aria-label="Fund with">
              {(["XLM", "USTRY"] as const).map((f) => <button key={f} type="button" role="radio" aria-checked={form.fund === f} className={`seg-btn ${form.fund === f ? "on" : ""}`} data-testid={`jar-fund-${f}`} onClick={() => setForm({ ...form, fund: f })}>{f === "XLM" ? "Fund with XLM" : "Fund with USTRY"}</button>)}
            </div>
            <input className="input" inputMode="decimal" placeholder="Target $ (optional)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            <input className="input" type="date" aria-label="Target date (optional)" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <button className="btn" data-testid="jar-create" onClick={create}>New Snowbank</button>
            <div className="muted jar-hint">{form.fund === "XLM" ? "XLM deposits are swapped into USTRY on Stellar's exchange when you deposit. You'll see the quote, fees and slippage limit before signing." : "Assign USTRY you already hold. No transaction, no fee."}</div>
            {formErr && <div className="muted neg" style={{ fontSize: "0.75rem" }}>{formErr}</div>}
          </div>
          {msg && <div className="notice neg" data-testid="jar-msg">{msg}</div>}

          {review && (
            <div className="card jar-review" data-testid="jar-review">
              <h3>Review: deposit to {review.jar.name}</h3>
              <dl className="jar-dl">
                <div><dt>You send</dt><dd className="mono">{n(review.amount)} XLM</dd></div>
                <div><dt>Quoted USTRY</dt><dd className="mono">{n(review.plan.quote.destAmount)} USTRY{review.plan.expectedUsd != null && ` (≈ ${usd(toUnitsN(review.plan.expectedUsd))})`}</dd></div>
                <div><dt>Route</dt><dd>XLM → {review.plan.quote.path.map((a) => (a.isNative() ? "XLM" : a.getCode())).join(" → ")}{review.plan.quote.path.length ? " → " : ""}USTRY (Stellar order book + pools)</dd></div>
                <div><dt>Slippage limit</dt><dd><select className="input" value={slip} onChange={(e) => { setSlip(Number(e.target.value)); setReview(null); }}>{[0.1, 0.5, 1, JAR_MAX_SLIPPAGE].map((s) => <option key={s} value={s}>{s}%</option>)}</select> · minimum {n(review.plan.minOut)} USTRY or nothing is swapped</dd></div>
                {review.plan.impactPct != null && <div><dt>Versus USTRY NAV</dt><dd>{review.plan.impactPct > 0 ? `${review.plan.impactPct.toFixed(2)}% below NAV value` : "at or above NAV value"}</dd></div>}
                <div><dt>Network fee</dt><dd className="mono">{n(review.feeXlm)} XLM</dd></div>
                <FeeRow lines={review.fees} />
                {review.needTrust && <div data-testid="jar-trustline"><dt>USTRY trustline</dt><dd>Added in the same transaction. Locks 0.5 XLM reserve while it exists.</dd></div>}
              </dl>
              <div className="jar-actions">
                <button className="btn" data-testid="jar-confirm-swap" disabled={busy} onClick={confirmSwap}>Sign & deposit</button>
                <button className="btn ghost" onClick={() => setReview(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="jar-grid">
            {jars.map((j, i) => {
              const v = jarView(j, priceOf(j.holding)), isV = j.holding === "VAULT", o = open[j.id];
              const same = jars.filter((k) => k.id !== j.id && k.holding === j.holding);
              return (
                <div className={`jar card ${v.done ? "done" : ""}`} key={j.id} data-testid="jar">
                  <div className="jar-top">
                    <span className="jar-ico" aria-hidden>{ICONS[i % ICONS.length]}</span><b>{j.name}</b>
                    <span className={`pill jar-asset ${isV ? "" : "gold"}`} data-testid="jar-asset">{isV ? "Vault shares (old)" : j.fund === "XLM" ? "USTRY · from XLM" : "USTRY"}</span>
                    {j.date && <span className="muted jar-date">by {j.date}</span>}
                  </div>
                  {v.pct !== null && <div className="jar-bar" role="progressbar" aria-valuenow={v.pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${v.pct}%` }} /></div>}
                  <div className="jar-stats">
                    <div><span>Value</span><b data-testid="jar-value">{usd(v.valueUsd)}</b></div>
                    <div><span>Put in</span><b>{isV ? `${fmt7(BigInt(j.costXlm ?? "0"))} XLM` : usd(BigInt(j.costUsd))}</b></div>
                    <div><span>Gain</span><b className={v.gainUsd !== null && v.gainUsd < 0n ? "neg" : "pos"}>{isV ? "0% (vault not earning)" : `${signedUsd(v.gainUsd)}${v.gainPct !== null ? ` · ${v.gainPct.toFixed(2)}%` : ""}`}</b></div>
                    <div><span>Holds</span><b>{fmt7(BigInt(j.units))} {isV ? "shares" : "USTRY"}</b></div>
                    {j.targetUsd && <div><span>Target</span><b>{usd(BigInt(j.targetUsd))} · {v.pct ?? 0}%</b></div>}
                  </div>
                  <div className="jar-actions">
                    {!isV && <input className="input" inputMode="decimal" placeholder={j.fund === "XLM" ? "XLM" : "USTRY"} value={amt[j.id] ?? ""} onChange={(e) => setAmt({ ...amt, [j.id]: e.target.value })} />}
                    {!isV && <button className="btn small" data-testid="jar-deposit" disabled={busy} onClick={() => (j.fund === "XLM" ? startSwap(j) : assign(j))}>{j.fund === "XLM" ? "Deposit" : "Assign"}</button>}
                    {!isV && <button className="btn small ghost" disabled={BigInt(j.units) <= 0n} onClick={() => release(j)} title="Release back to Unassigned (no transaction)">Release</button>}
                    {isV && <button className="btn small ghost" disabled={busy || BigInt(j.units) <= 0n} onClick={() => vaultWithdraw(j)}>Withdraw</button>}
                  </div>
                  <div className="jar-links">
                    {same.length > 0 && BigInt(j.units) > 0n && <button className="linkish" onClick={() => setOpen({ ...open, [j.id]: o === "move" ? undefined : "move" })}>Move</button>}
                    <button className="linkish" onClick={() => setOpen({ ...open, [j.id]: o === "rename" ? undefined : "rename" })}>Rename</button>
                    <button className="linkish" data-testid="jar-history-toggle" onClick={() => setOpen({ ...open, [j.id]: o === "history" ? undefined : "history" })}>History ({j.history.length})</button>
                    {BigInt(j.units) === 0n && <button className="linkish" onClick={() => act(() => closeJar(ledger, j.id))}>Close</button>}
                  </div>
                  {o === "move" && (
                    <div className="jar-actions">
                      <select className="input" value={moveTo[j.id] ?? ""} onChange={(e) => setMoveTo({ ...moveTo, [j.id]: e.target.value })} aria-label="Move to Snowbank">
                        <option value="">Move to…</option>{same.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                      </select>
                      <button className="btn small" onClick={() => move(j)}>Move {amt[j.id]?.trim() ? amt[j.id] : "all"}</button>
                      <span className="muted small">Free, no transaction. Cost basis moves in proportion.</span>
                    </div>
                  )}
                  {o === "rename" && (
                    <div className="jar-actions"><input className="input" defaultValue={j.name} maxLength={40} id={`rn-${j.id}`} />
                      <button className="btn small" onClick={() => { act(() => renameJar(ledger, j.id, (document.getElementById(`rn-${j.id}`) as HTMLInputElement).value)); setOpen({ ...open, [j.id]: undefined }); }}>Save</button></div>
                  )}
                  {o === "history" && (
                    <ol className="jar-history" data-testid="jar-history">
                      {[...j.history].reverse().map((e, k) => { const url = e.tx ? explorerTxUrl(e.tx) : null; return (
                        <li key={k}><span className="muted">{new Date(e.ts).toLocaleString()}</span> <b>{e.type}</b>{e.units && ` ${fmt7(BigInt(e.units))} ${isV ? "shares" : "USTRY"}`}{e.usd && e.usd !== "0" && ` · ${usd(BigInt(e.usd))}`}{e.xlm && ` · ${fmt7(BigInt(e.xlm))} XLM`}{e.note && <span className="muted"> · {e.note}</span>}
                          {url && <> · <a href={url} target="_blank" rel="noreferrer">StellarChain.io</a></>}</li>); })}
                    </ol>
                  )}
                </div>
              );
            })}
            {!jars.length && <div className="muted">No Snowbanks yet. Create one above.</div>}
          </div>
          <p className="muted small">Prices: USTRY from Etherfuse's NAV feed, XLM/USD from the Stellar XLM/USDC order book. Market price can differ from NAV. <a href={explorerAssetUrl(USTRY_REF.code, USTRY_REF.issuer) ?? "#"} target="_blank" rel="noreferrer">USTRY on StellarChain.io</a></p>
          <TxStatus status={status} />
        </>
      )}
    </section>
  );
}
