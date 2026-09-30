import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Asset, type Transaction } from "@stellar/stellar-sdk";
import { PageHead, Stat, Tabs, TxStatus, useTx } from "../components/ui";
import { AssetLogo } from "../components/AssetBits";
import { fmt, fmtCompact, parseUnits, short } from "../lib/format";
import { buildTrustline, fetchBalances, submitSignedXdr, type Balance } from "../lib/stellar";
import {
  LENDING, MAX_I128, addrv, applyAction, aprToApy, boolv, hfLabel, hfTone, i128v, liquidationPrice, preparePoolCall, readPrices, readReserves,
  readUserPositions, submitPrepared, toTok, totals, txrep, type Action, type LendingAsset, type PositionUsd, type ReserveView, type UserReserve,
} from "../lib/lending";
import AnchorPanel from "../components/AnchorPanel";

type Market = LendingAsset & { live: ReserveView | null; price: number; priceTs: number | null };
type Review = { title: string; label: string; summary: string[]; tx: Transaction; lines: string[] };

const toneColor = { safe: "var(--green)", warn: "var(--amber)", danger: "var(--red)", none: "var(--text-2)" } as const;
const hoverOf = (a: LendingAsset) =>
  [`${a.code} — ${a.name ?? ""}`, `Mainnet: ${a.canonical}`, a.homeDomain ? `Home domain: ${a.homeDomain}` : null, `Testnet asset used: ${a.testnetCanonical}`, `SAC (SEP-41): ${a.sac}`].filter(Boolean).join("\n");
const pctBps = (bps: number) => `${fmt(bps / 100, bps % 100 ? 1 : 0)}%`;
const usdFmt = (n: number) => (n >= 1e4 ? `$${fmtCompact(n)}` : `$${fmt(n, 2)}`);
const tokFmt = (n: number) => (n === 0 ? "0" : n < 1 ? String(Number(n.toPrecision(3))) : fmtCompact(n));
const priceFmt = (p: number) => (p >= 100 ? `$${fmt(p, 2)}` : p >= 0.01 ? `$${fmt(p, 4)}` : `$${p.toPrecision(3)}`);

function KindBadge({ a }: { a: LendingAsset }) {
  const real = a.testnetKind === "real" || a.testnetKind === "native";
  return (
    <span className={`pill ${real ? "green" : "pink"}`} title={real ? "Real testnet asset (no value)" : `Quasaria testnet mirror of ${a.canonical}: not redeemable, no value`} style={{ fontSize: "0.62rem", padding: "1px 6px" }}>
      {real ? (a.testnetKind === "native" ? "native" : "real testnet") : "mirror"}
    </span>
  );
}

function HfGauge({ hf }: { hf: number }) {
  const tone = hfTone(hf);
  const pos = !Number.isFinite(hf) ? 100 : Math.max(0, Math.min(100, ((hf - 1) / 2) * 100));
  return (
    <div data-testid="hf-gauge">
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: "0.75rem" }}>Health factor</span>
        <b style={{ color: toneColor[tone], fontSize: "1.3rem" }}>{hfLabel(hf)}</b>
      </div>
      <div className="gauge" aria-label={`health factor ${hfLabel(hf)}`}><i style={{ left: `calc(${pos}% - 2px)` }} /></div>
      <div className="row between muted" style={{ fontSize: "0.65rem", marginTop: 4 }}><span>1.0 liquidation</span><span>2.0</span><span>3.0+ safe</span></div>
      {tone === "danger" && <div className="notice warn" style={{ marginTop: 8 }}>⚠ Your health factor is close to 1.0. If it drops below 1, anyone can repay part of your debt and take some of your collateral plus a bonus. Repay or add collateral to stay safe.</div>}
    </div>
  );
}

export default function Lending() {
  const tx = useTx();
  const me = tx.wallet.address;
  const [reserves, setReserves] = useState<ReserveView[] | null>(null);
  const [prices, setPrices] = useState<Map<string, { usd: number; ts: number }>>(new Map());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [mine, setMine] = useState<UserReserve[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [nonce, setNonce] = useState(0);
  const [cat, setCat] = useState<"all" | "stablecoin" | "popular">("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>(LENDING.reserves.find((r) => r.id === "USDC")?.sac ?? LENDING.reserves[0].sac);
  const [action, setAction] = useState<Action>("supply");
  const [amount, setAmount] = useState("");
  const [isMax, setIsMax] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [prepErr, setPrepErr] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [r, p] = await Promise.all([readReserves(), readPrices(LENDING.reserves.map((x) => x.sac))]);
        if (!alive) return;
        setReserves(r);
        setPrices(p);
        setLoadErr(null);
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [nonce]);
  useEffect(() => {
    if (!me) { setMine([]); setBalances([]); return; }
    let alive = true;
    readUserPositions(me).then((x) => alive && setMine(x)).catch(() => alive && setMine([]));
    fetchBalances(me).then((b) => alive && setBalances(b)).catch(() => alive && setBalances([]));
    return () => { alive = false; };
  }, [me, nonce]);

  const markets: Market[] = useMemo(() => {
    const byAsset = new Map((reserves ?? []).map((r) => [r.asset, r]));
    return LENDING.reserves.map((a) => {
      const p = prices.get(a.sac);
      return { ...a, live: byAsset.get(a.sac) ?? null, price: p?.usd ?? a.seedPriceUsd, priceTs: p?.ts ?? null };
    });
  }, [reserves, prices]);
  const m = markets.find((x) => x.sac === sel)!;
  const nowS = Date.now() / 1000;
  const stale = m.priceTs !== null && nowS - m.priceTs > LENDING.poolConfig.maxPriceAgeSec;

  const posUsd: PositionUsd[] = useMemo(() => mine.map((u) => {
    const mk = markets.find((x) => x.sac === u.asset)!;
    const sup = toTok(u.supplied, mk.config.decimals) * mk.price, bor = toTok(u.borrowed, mk.config.decimals) * mk.price;
    return { sac: u.asset, suppliedUsd: sup, borrowedUsd: bor, collateral: u.collateral, ltvBps: mk.config.ltv_bps, thresholdBps: mk.config.liq_threshold_bps, collateralEnabled: mk.config.collateral_enabled,
      supplyApy: aprToApy(Number(mk.live?.supply_rate_bps ?? 0)), borrowApy: aprToApy(Number(mk.live?.borrow_rate_bps ?? 0)) };
  }), [mine, markets]);
  const t = totals(posUsd);
  const myPos = mine.find((u) => u.asset === sel);
  const bal = (a: LendingAsset) => balances.find((b) => (a.testnetKind === "native" ? b.isNative : b.code === a.testnetCode && b.issuer === a.testnetIssuer));
  const trustMissing = !!me && m.testnetKind !== "native" && balances.length > 0 && !bal(m);

  // ------------------------------------------------ preview
  let amt = 0;
  try { amt = amount ? toTok(parseUnits(amount), 0) / 1e7 : 0; } catch { amt = NaN; }
  const maxFor = (): number => {
    const d = m.config.decimals;
    if (action === "withdraw") return myPos ? toTok(myPos.supplied, d) : 0;
    if (action === "repay") return myPos ? toTok(myPos.borrowed, d) : 0;
    if (action === "supply") return Math.max(0, (bal(m)?.balance ?? 0) - (m.testnetKind === "native" ? 5 : 0));
    const room = Math.max(0, t.borrowLimitUsd - t.debtUsd) * 0.99;
    return Math.min(room / m.price, m.live ? toTok(m.live.state.cash, d) : 0);
  };
  const usd = (Number.isFinite(amt) ? amt : 0) * m.price;
  const tmpl = { sac: sel, collateral: false, ltvBps: m.config.ltv_bps, thresholdBps: m.config.liq_threshold_bps, collateralEnabled: m.config.collateral_enabled, supplyApy: 0, borrowApy: 0 };
  const after = totals(applyAction(posUsd, sel, action, usd, tmpl));
  const liqAssetSac = (() => {
    const ps = applyAction(posUsd, sel, action, usd, tmpl).filter((p) => p.collateral && p.suppliedUsd > 0).sort((a, b) => b.suppliedUsd - a.suppliedUsd);
    return ps[0]?.sac ?? null;
  })();
  const liqAsset = liqAssetSac ? markets.find((x) => x.sac === liqAssetSac)! : null;
  const liqPx = liqAsset ? liquidationPrice(applyAction(posUsd, sel, action, usd, tmpl), liqAsset.sac, liqAsset.price) : null;
  const minSupply = toTok(m.config.min_supply, m.config.decimals), minBorrow = toTok(m.config.min_borrow, m.config.decimals);
  const warnings: string[] = [];
  if (action === "borrow" && !m.config.borrowable) warnings.push(`${m.code} can't be borrowed.`);
  if (action === "borrow" && amt > 0 && amt < minBorrow) warnings.push(`Minimum borrow is ${fmt(minBorrow, 4)} ${m.code}.`);
  if (action === "supply" && amt > 0 && amt + toTok(myPos?.supplied ?? 0n, 7) < minSupply) warnings.push(`Minimum supply is ${fmt(minSupply, 4)} ${m.code}.`);
  if ((action === "borrow" || action === "withdraw") && after.debtUsd > 0 && after.hf < 1) warnings.push("This would drop your health factor below 1.0: the pool will reject it.");
  if (action === "borrow" && after.debtUsd > after.borrowLimitUsd + 1e-9) warnings.push("This is above your borrow limit (collateral × LTV).");
  if (stale) warnings.push("The oracle price for this asset is stale: borrowing and HF-checked actions will fail until the testnet price keeper refreshes it.");

  const label = { supply: "Lend supply", withdraw: "Lend withdraw", borrow: "Lend borrow", repay: "Lend repay" }[action];
  const verb = { supply: "Supply", withdraw: "Withdraw", borrow: "Borrow", repay: "Repay" }[action];

  const openReview = useCallback(async (kind: "action" | "collateral", opts?: { sac?: string; enable?: boolean }) => {
    if (!me) { tx.wallet.openModal(); return; }
    setPrepErr(null);
    setPreparing(true);
    try {
      if (kind === "collateral") {
        const a = markets.find((x) => x.sac === opts!.sac)!;
        const prepared = await preparePoolCall(me, "set_collateral", [addrv(me), addrv(a.sac), boolv(!!opts!.enable)]);
        setReview({
          title: `${opts!.enable ? "Use" : "Stop using"} ${a.code} as collateral`, label: "Lend collateral", tx: prepared,
          summary: [opts!.enable ? `${a.code} will count toward your borrow limit (LTV ${pctBps(a.config.ltv_bps)}) and can be seized if your health factor drops below 1.` : `${a.code} will no longer back your debt. The pool rejects this if your health factor would drop below 1.`],
          lines: txrep(prepared, ["you", `${a.testnetCanonical}`, opts!.enable ? "enable" : "disable"]),
        });
        return;
      }
      const raw = isMax && (action === "withdraw" || action === "repay") ? MAX_I128 : parseUnits(amount || "0", m.config.decimals);
      if (raw <= 0n) throw new Error("enter an amount");
      const args = action === "repay" ? [addrv(me), addrv(me), addrv(sel), i128v(raw)] : [addrv(me), addrv(sel), i128v(raw)];
      const prepared = await preparePoolCall(me, action, args);
      const amtText = raw === MAX_I128 ? `everything (${fmt(maxFor(), 7)} ${m.code} now; interest accrues until inclusion)` : `${amount} ${m.code} (≈ ${usdFmt(usd)})`;
      const summary = [
        `${verb} ${amtText}.`,
        `Asset: ${m.testnetCanonical}${m.testnetKind === "mirror" ? ` — testnet mirror of ${m.canonical}` : ""}.`,
        `Health factor: ${hfLabel(t.hf)} → ${hfLabel(after.hf)} · borrow limit used: ${fmt(Math.min(t.limitUsed, 9.99) * 100, 1)}% → ${fmt(Math.min(after.limitUsed, 9.99) * 100, 1)}%.`,
        liqPx && liqAsset ? `Liquidation if ${liqAsset.code} ${liqAsset.sac === sel && action === "borrow" ? "rises" : "falls"} to about ${priceFmt(liqPx)} (now ${priceFmt(liqAsset.price)}), other prices unchanged.` : "No liquidation risk: you have no debt after this.",
        action === "borrow" ? `Variable rate: currently ${fmt(aprToApy(Number(m.live?.borrow_rate_bps ?? 0)) * 100, 2)}% APY and it rises steeply above ${pctBps(m.config.optimal_util_bps)} utilization.` : "",
      ].filter(Boolean);
      const noteAmt = raw === MAX_I128 ? "i128::MAX = all" : `${amount} ${m.code}`;
      const notes = action === "repay" ? ["payer (you)", "on behalf of (you)", m.testnetCanonical, noteAmt] : ["you", m.testnetCanonical, noteAmt];
      setReview({ title: `${verb} ${m.code}`, label, summary, tx: prepared, lines: txrep(prepared, notes) });
    } catch (e) {
      setPrepErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  }, [me, markets, isMax, action, amount, m, sel, usd, t, after, liqPx, liqAsset, verb, label, tx.wallet]);

  const sign = () => {
    const r = review!;
    setReview(null);
    tx.run(r.label, async () => {
      const h = (await submitPrepared(r.tx, tx.wallet.sign)).hash.slice(0, 10);
      setAmount("");
      setIsMax(false);
      setNonce((n) => n + 1);
      return h;
    });
  };

  const list = markets.filter((x) => (cat === "all" || x.category === cat) && (!q.trim() || `${x.code} ${x.name ?? ""} ${x.canonical}`.toLowerCase().includes(q.trim().toLowerCase())));
  const pick = (sac: string) => { setSel(sac); setAmount(""); setIsMax(false); setPrepErr(null); };

  return (
    <>
      <PageHead kicker="Scene · Orbital Rings" title="Lend & borrow" right={<div className="row" style={{ flexWrap: "wrap" }}>
        {reserves ? <span className="pill green">● live · Soroban testnet</span> : loadErr ? <span className="pill pink" title={loadErr}>RPC error · showing listed params</span> : <span className="pill">⟳ reading testnet…</span>}
        <span className="pill gold">Testnet-only · unaudited</span>
        <a className="pill cyan mono" href={`https://stellar.expert/explorer/testnet/contract/${LENDING.pool}`} target="_blank" rel="noreferrer" title="Lending pool contract">{short(LENDING.pool, 5)}</a>
      </div>}>
        Supply assets to earn interest, or borrow against what you supplied. Rates change with demand. If your collateral's value falls too far, part of it can be sold to repay your loan.
      </PageHead>

      <div className="risk" style={{ marginBottom: 16 }} data-testid="lending-risk">
        <strong>BEFORE YOU LEND OR BORROW</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          <li><b>Liquidation:</b> if your health factor falls below 1.0, a liquidator can repay up to 50% of one of your debts and take the same value of your collateral <i>plus a 5–8% bonus</i>. You lose that bonus.</li>
          <li><b>Variable rates:</b> borrow and supply rates move every block with utilization; above each asset's "kink" the borrow rate climbs steeply.</li>
          <li><b>Testnet mirrors:</b> except native XLM and Circle's testnet USDC, the assets here are Quasaria testnet mirrors ("mk…"). They have no value and can't be redeemed. Prices are copied from mainnet by a testnet keeper.</li>
          <li><b>Unaudited:</b> this contract hasn't been audited. TESTNET ONLY. Never use real funds.</li>
        </ul>
      </div>

      <div className="grid g-main-side" style={{ alignItems: "start" }}>
        <div className="card" data-testid="lending-position">
          <h2>Your position</h2>
          {!me ? (
            <p className="muted">Connect a testnet wallet (or create an in-app account) to see your supplies, loans and health factor. <button className="btn small" onClick={() => tx.wallet.openModal()}>Connect</button></p>
          ) : (
            <>
              <div className="grid g-4" style={{ marginBottom: 12 }}>
                <Stat label="Supplied" value={usdFmt(t.suppliedUsd)} />
                <Stat label="Borrowed" value={usdFmt(t.debtUsd)} />
                <Stat label="Net APY" value={`${fmt(t.netApy * 100, 2)}%`} className={t.netApy >= 0 ? "pos" : "neg"} sub="earned − paid, on net worth" />
                <Stat label="Borrow limit used" value={`${fmt(Math.min(t.limitUsed, 9.99) * 100, 1)}%`} sub={`of ${usdFmt(t.borrowLimitUsd)}`} />
              </div>
              <HfGauge hf={t.hf} />
              {mine.length > 0 && (
                <table className="t" style={{ marginTop: 12 }}>
                  <thead><tr><th>Asset</th><th>Supplied</th><th>Borrowed</th><th>Collateral</th></tr></thead>
                  <tbody>
                    {mine.map((u) => {
                      const a = markets.find((x) => x.sac === u.asset)!;
                      return (
                        <tr key={u.asset}>
                          <td title={hoverOf(a)}><span className="row" style={{ gap: 6 }}><AssetLogo code={a.code} logo={a.logo} size={18} /><b>{a.code}</b></span></td>
                          <td className="mono">{fmt(toTok(u.supplied), 4)}</td>
                          <td className="mono">{fmt(toTok(u.borrowed), 4)}</td>
                          <td>
                            {u.supplied > 0n ? (
                              a.config.collateral_enabled || u.collateral ? (
                                <label className="row" style={{ gap: 6, cursor: "pointer" }}>
                                  <input type="checkbox" checked={u.collateral} disabled={preparing || tx.busy} onChange={(e) => openReview("collateral", { sac: u.asset, enable: e.target.checked })} aria-label={`use ${a.code} as collateral`} />
                                  <span className="muted" style={{ fontSize: "0.75rem" }}>{u.collateral ? "on" : "off"}</span>
                                </label>
                              ) : <span className="muted" style={{ fontSize: "0.75rem" }}>not allowed</span>
                            ) : <span className="muted">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div className="card glow" data-testid="lending-action">
          <h2 className="row" style={{ gap: 8, flexWrap: "wrap" }} title={hoverOf(m)}>
            <AssetLogo code={m.code} logo={m.logo} size={22} />{m.code} <KindBadge a={m} />
            {m.config.collateral_enabled ? <span className="pill cyan" style={{ fontSize: "0.62rem", padding: "1px 6px" }}>can be collateral</span> : <span className="pill" style={{ fontSize: "0.62rem", padding: "1px 6px" }}>not collateral</span>}
          </h2>
          <p className="muted mono" style={{ fontSize: "0.68rem", marginTop: -6, wordBreak: "break-all" }} title={hoverOf(m)}>{m.testnetCanonical} · SAC {short(m.sac, 6)} · {priceFmt(m.price)}{stale ? " (stale)" : ""}</p>
          <Tabs value={action} onChange={(v) => { setAction(v); setIsMax(false); setAmount(""); setPrepErr(null); }} options={[{ v: "supply", label: "Supply" }, { v: "withdraw", label: "Withdraw" }, { v: "borrow", label: "Borrow" }, { v: "repay", label: "Repay" }]} />
          {trustMissing && (action === "supply" || action === "borrow") && (
            <div className="notice warn">Your account needs a <b>{m.testnetCode}</b> trustline first (0.5 XLM reserve). <button className="btn small" disabled={tx.busy} onClick={() => tx.run(`trustline ${m.testnetCode}`, async () => { const h = (await submitSignedXdr(await tx.wallet.sign(await buildTrustline(me!, new Asset(m.testnetCode, m.testnetIssuer!))))).hash.slice(0, 10); setNonce((n) => n + 1); return h; })}>Add trustline</button>
              {m.testnetKind === "mirror" && <div className="muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>Get some by swapping XLM on the <Link to="/trade">Trade</Link> page.</div>}
            </div>
          )}
          <div className="field">
            <label className="row between"><span>Amount ({m.code})</span>{me && <button className="btn small ghost" onClick={() => { const mx = maxFor(); setAmount(mx > 0 ? String(Math.floor(mx * 1e7) / 1e7) : ""); setIsMax(action === "withdraw" || action === "repay"); }}>Max {fmt(maxFor(), 4)}</button>}</label>
            <input className="input" placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setIsMax(false); }} data-testid="lending-amount" />
          </div>
          <div className="grid g-2" style={{ margin: "10px 0" }} data-testid="lending-preview">
            <Stat label="Health factor" value={!Number.isFinite(t.hf) && !Number.isFinite(after.hf) ? <span>∞</span> : <span><span style={{ color: toneColor[hfTone(t.hf)] }}>{Number.isFinite(t.hf) ? hfLabel(t.hf) : "∞"}</span> → <b style={{ color: toneColor[hfTone(after.hf)] }}>{Number.isFinite(after.hf) ? hfLabel(after.hf) : "∞"}</b></span>} sub={!Number.isFinite(after.hf) ? "no debt" : "liquidation below 1.00"} />
            <Stat label="Borrow limit used" value={<span>{fmt(Math.min(t.limitUsed, 9.99) * 100, 1)}% → <b>{fmt(Math.min(after.limitUsed, 9.99) * 100, 1)}%</b></span>} sub={`limit ${usdFmt(after.borrowLimitUsd)}`} />
            <Stat label="Liquidation price" value={liqPx && liqAsset ? `${priceFmt(liqPx)}` : "—"} sub={liqPx && liqAsset ? `${liqAsset.code}, now ${priceFmt(liqAsset.price)}` : "no debt"} />
            <Stat label={action === "borrow" || action === "repay" ? "Borrow APY" : "Supply APY"} value={`${fmt(aprToApy(Number((action === "borrow" || action === "repay" ? m.live?.borrow_rate_bps : m.live?.supply_rate_bps) ?? 0)) * 100, 2)}%`} sub="variable" />
          </div>
          {warnings.map((w) => <div key={w} className="notice warn" style={{ marginBottom: 6 }}>{w}</div>)}
          {prepErr && <div className="notice warn">{prepErr}</div>}
          <button className="btn" style={{ width: "100%" }} disabled={preparing || tx.busy || !(amt > 0) || (action === "borrow" && !m.config.borrowable)} onClick={() => openReview("action")} data-testid="lending-review">
            {preparing ? "Preparing…" : me ? `Review ${verb.toLowerCase()}` : "Connect to continue"}
          </button>
          <details style={{ marginTop: 12 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: "0.8rem" }}>{m.code} risk parameters ({m.tierLabel})</summary>
            <table className="t" style={{ marginTop: 6 }}>
              <tbody>
                <tr><td>LTV / liquidation threshold</td><td className="mono">{pctBps(m.config.ltv_bps)} / {pctBps(m.config.liq_threshold_bps)}</td></tr>
                <tr><td>Liquidation bonus</td><td className="mono">{pctBps(m.config.liq_bonus_bps)}</td></tr>
                <tr><td>Reserve factor</td><td className="mono">{pctBps(m.config.reserve_factor_bps)}</td></tr>
                <tr><td>Rate model</td><td className="mono">{pctBps(m.config.base_rate_bps)} + {pctBps(m.config.slope1_bps)} to {pctBps(m.config.optimal_util_bps)} util, then +{pctBps(m.config.slope2_bps)}</td></tr>
                <tr><td>Supply / borrow cap</td><td className="mono">{fmtCompact(toTok(m.config.supply_cap))} / {fmtCompact(toTok(m.config.borrow_cap))} {m.code}</td></tr>
                <tr><td>Min supply / borrow</td><td className="mono">{fmt(minSupply, 4)} / {fmt(minBorrow, 4)}</td></tr>
                <tr><td>Borrowable</td><td>{m.config.borrowable ? "yes" : "no"}</td></tr>
              </tbody>
            </table>
          </details>
        </div>
      </div>

      <TxStatus status={tx.status} />

      <div className="card" style={{ marginTop: 18 }} data-testid="lending-markets">
        <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Markets <span className="muted" style={{ fontSize: "0.8rem" }}>({LENDING.reserves.length})</span></h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Tabs value={cat} onChange={setCat} options={[{ v: "all", label: "All" }, { v: "stablecoin", label: "Stablecoins" }, { v: "popular", label: "Popular" }]} />
            <input className="input" style={{ width: 150 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search markets" />
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="t" style={{ marginTop: 8 }}>
            <thead><tr><th>Asset</th><th>Total supplied</th><th>Total borrowed</th><th>Supply APY</th><th>Borrow APY</th><th>Utilization</th><th>LTV</th><th>Collateral</th><th /></tr></thead>
            <tbody>
              {list.map((x) => {
                const ts = x.live ? toTok(x.live.total_supply) : null, tb = x.live ? toTok(x.live.total_debt) : null;
                return (
                  <tr key={x.sac} onClick={() => pick(x.sac)} style={{ cursor: "pointer", outline: x.sac === sel ? "1px solid var(--quasar)" : undefined }}>
                    <td title={hoverOf(x)}><span className="row" style={{ gap: 8 }}><AssetLogo code={x.code} logo={x.logo} size={22} /><span><b>{x.code}</b> <KindBadge a={x} />{x.offPeg && <span className="pill gold" style={{ fontSize: "0.6rem", padding: "1px 5px", marginLeft: 4 }} title="Mainnet price is far from its peg; priced at market">off-peg</span>}<div className="muted" style={{ fontSize: "0.66rem" }}>{x.homeDomain ?? (x.testnetKind === "native" ? "native" : "")}</div></span></span></td>
                    <td className="mono">{ts === null ? "—" : <>{tokFmt(ts)}<div className="muted" style={{ fontSize: "0.66rem" }}>{usdFmt(ts * x.price)}</div></>}</td>
                    <td className="mono">{tb === null ? "—" : <>{tokFmt(tb)}<div className="muted" style={{ fontSize: "0.66rem" }}>{usdFmt(tb * x.price)}</div></>}</td>
                    <td className="mono pos">{x.live ? `${fmt(aprToApy(Number(x.live.supply_rate_bps)) * 100, 2)}%` : "—"}</td>
                    <td className="mono">{x.config.borrowable ? (x.live ? `${fmt(aprToApy(Number(x.live.borrow_rate_bps)) * 100, 2)}%` : "—") : <span className="muted">n/a</span>}</td>
                    <td className="mono">{x.live ? pctBps(Number(x.live.utilization_bps)) : "—"}</td>
                    <td className="mono">{x.config.collateral_enabled ? pctBps(x.config.ltv_bps) : "0%"}</td>
                    <td>{x.config.collateral_enabled ? <span className="pill cyan" style={{ fontSize: "0.6rem", padding: "1px 6px" }}>can be collateral</span> : <span className="muted" style={{ fontSize: "0.72rem" }}>{x.offPeg ? "off-peg: no" : "no"}</span>}</td>
                    <td><button className="btn small ghost" onClick={(e) => { e.stopPropagation(); pick(x.sac); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Select</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: "0.75rem" }}>APY = the current variable APR compounded daily; it changes with utilization. Prices: Quasaria mock oracle (SEP-40 interface), refreshed from live Stellar mainnet markets by a testnet keeper; rejected by the pool if older than {LENDING.poolConfig.maxPriceAgeSec / 60} minutes. Hover an asset for its CODE:ISSUER, home domain and SAC.</p>
      </div>

      <AnchorPanel selected={m} />

      <div className="card" style={{ marginTop: 18 }}>
        <h2>How it works</h2>
        <ul className="muted">
          <li><b>Supply</b> an asset and you start earning its supply rate. Your balance grows automatically (an interest index, so there's nothing to claim).</li>
          <li><b>Collateral:</b> supplied assets that are allowed as collateral count toward your <b>borrow limit</b> = value × LTV. You can switch each one on or off.</li>
          <li><b>Borrow</b> up to your limit. Interest accrues every second at a variable rate.</li>
          <li><b>Health factor</b> = (collateral × liquidation threshold) ÷ debt. Above 1 you're safe; below 1 your loan can be liquidated in 50% steps (the whole loan only when it's tiny).</li>
          <li><b>Repay</b> any time, even while the pool is paused. Anyone may repay a loan on someone else's behalf.</li>
          <li>Every transaction shows a readable preview of exactly what your wallet will sign. See the <a href="https://github.com/yogibear1323/quasaria/blob/main/docs/lending.md" target="_blank" rel="noreferrer">lending design doc</a> for all parameters.</li>
        </ul>
      </div>

      {review && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Review transaction" onMouseDown={(e) => e.target === e.currentTarget && setReview(null)}>
          <div className="card glow modal" data-testid="lending-txrep">
            <h2>{review.title}</h2>
            <ul style={{ paddingLeft: 18 }}>{review.summary.map((s) => <li key={s}>{s}</li>)}</ul>
            <div className="muted" style={{ fontSize: "0.72rem", margin: "8px 0 4px" }}>Transaction (SEP-11 Txrep-style, from the exact envelope your wallet will sign):</div>
            <pre className="mono" style={{ fontSize: "0.66rem", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 260, overflow: "auto", background: "rgba(0,0,0,.3)", padding: 10, borderRadius: 8 }}>{review.lines.join("\n")}</pre>
            <p className="muted" style={{ fontSize: "0.72rem" }}>Testnet only. Unaudited contract. The pool re-checks everything on-chain; if prices move before inclusion the transaction may fail safely.</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={sign} data-testid="lending-sign">Sign & submit</button>
              <button className="btn ghost" onClick={() => setReview(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
