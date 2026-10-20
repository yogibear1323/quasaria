import { curatedList } from "../lib/nativePools";
import { NETWORK, IS_MAINNET } from "../lib/config";
import { useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { Link, useSearchParams } from "react-router-dom";
import { PageHead } from "../components/ui";
import { AssetPicker, toOption, type PickerOption } from "../components/AssetBits";
import { TxLink } from "../components/TxLink";
import { useWallet } from "../lib/wallet";
import { useAsync } from "../lib/useAsync";
import { loadMarkets, type MarketRow } from "../lib/markets";
import { ASSETS, assetFromKey, assetKeyOf, findStrictSendPath, horizon, submitSignedXdr } from "../lib/stellar";
import { fetchBaseReserve, fetchRawAccount } from "../lib/account";
import { NETWORK_PASSPHRASE } from "../lib/config";
import { ASSET_LIST, badgeOf, testnetKey } from "../lib/assets";
import { XLM_LOGO } from "../lib/xlm";
import { DEFAULT_SLIPPAGE_PCT, SLIPPAGE_PRESETS, buildSwapTx, checkSwapFunds, clampSlippage, minReceived, parseQuote, parseSwapReceived, plainSwapError, type SwapQuote } from "../lib/swap";
import { fmt } from "../lib/format";

const XLM_OPT: PickerOption = { key: "XLM", code: "XLM", sub: "Stellar Lumens (native)", logo: XLM_LOGO };
const DEFAULT_TO = assetKeyOf(ASSETS.USDC);
const CURATED: PickerOption[] = IS_MAINNET
  ? curatedList("mainnet").filter((a) => a.issuer).map((a) => ({ key: `${a.code}-${a.issuer}`, code: a.code, sub: `${a.name}${a.homeDomain ? ` · ${a.homeDomain}` : ""}`, logo: a.logo }))
  : ASSET_LIST.filter((a) => a.testnet.kind !== "native").map((a) => ({ key: testnetKey(a), code: a.code, sub: `${badgeOf(a).text}${a.org ? ` · ${a.org}` : ""}`, logo: a.logo }));
const refOf = (k: string) => { const a = assetFromKey(k); return { code: a.isNative() ? "XLM" : a.getCode(), issuer: a.isNative() ? null : a.getIssuer() ?? null }; };
const px = (v: number) => (v >= 0.01 ? fmt(v, 5) : v.toPrecision(4));
const n7 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 7 });
const codeOf = (a: Asset) => (a.isNative() ? "XLM" : a.getCode());

type Frozen = { quote: SwapQuote; minOut: number; slippage: number; needTrust: Asset[]; feeXlm: number; reserveXlm: number };
type Done = { text: string; hash: string };

export default function Swap() {
  const w = useWallet();
  const [params, setParams] = useSearchParams();
  const fromKey = params.get("from") || "XLM";
  const toKey = params.get("to") || (fromKey === "XLM" ? DEFAULT_TO : "XLM");
  const [market, setMarket] = useState<MarketRow[]>([]);
  useEffect(() => { loadMarkets(NETWORK, { itemsPerPage: 30, enrich: 0 }).then((d) => setMarket(d.rows)).catch(() => void 0); }, []);
  const options = useMemo(() => {
    const o = [XLM_OPT, ...CURATED, ...market.map(toOption)];
    const seen = new Set<string>();
    return o.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
  }, [market]);
  const optFor = (key: string): PickerOption => options.find((o) => o.key === key) ?? { key, code: key.split("-")[0], sub: key.includes("-") ? `unverified issuer ${key.split("-")[1].slice(0, 4)}…${key.split("-")[1].slice(-4)}` : null };
  const fromOpt = optFor(fromKey), toOpt = optFor(toKey);
  const setPair = (f: string, t: string) => setParams(f === "XLM" && t === DEFAULT_TO ? {} : { from: f, to: t });
  const pick = (which: "from" | "to", o: PickerOption) => {
    const next = { from: fromKey, to: toKey, [which]: o.key };
    if (next.from === next.to) next[which === "from" ? "to" : "from"] = next.from === "XLM" ? DEFAULT_TO : "XLM";
    setPair(next.from, next.to);
  };

  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(DEFAULT_SLIPPAGE_PCT);
  const [custom, setCustom] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(amount), 350); return () => clearTimeout(t); }, [amount]);
  const amt = Number(debounced);
  const from = assetFromKey(fromKey), to = assetFromKey(toKey);
  const quote = useAsync<SwapQuote | null>(async () => {
    if (!(amt > 0)) return null;
    return parseQuote(amt, (await findStrictSendPath(from, amt, to)) as never);
  }, [fromKey, toKey, debounced]);
  const q = quote.data;
  const min = q ? minReceived(q.destAmount, slip) : 0;

  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const review = async () => {
    setErr(null); setDone(null);
    if (!w.address) { w.openModal(); return; }
    if (!q) { setErr(amt > 0 ? "No route found for this pair right now." : "Enter an amount."); return; }
    setBusy(true);
    try {
      const [acct, reserve, fresh] = await Promise.all([fetchRawAccount(NETWORK, w.address), fetchBaseReserve(NETWORK), findStrictSendPath(from, amt, to).then((r) => parseQuote(amt, r as never))]);
      if (!fresh) { setErr("No route found for this pair right now."); return; }
      const f = checkSwapFunds({ from: refOf(fromKey), to: refOf(toKey), amount: amt, acct, baseReserve: reserve });
      if (!f.ok) { setErr(f.error); return; }
      const s = clampSlippage(slip);
      setFrozen({ quote: fresh, minOut: minReceived(fresh.destAmount, s), slippage: s, needTrust: f.needTrust.map((r) => new Asset(r.code, r.issuer!)), feeXlm: f.feeXlm, reserveXlm: f.reserveXlm });
      setStage("confirm");
    } catch (e) { setErr(`Could not get a quote: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!frozen || !w.address) return;
    setBusy(true); setErr(null);
    try {
      const me = w.address;
      const seq = (await horizon.loadAccount(me)).sequenceNumber();
      const xdr = buildSwapTx({ source: me, sequence: seq, from, to, amount: amt, minOut: frozen.minOut, path: frozen.quote.path, needTrust: frozen.needTrust, passphrase: NETWORK_PASSPHRASE });
      const r = await submitSignedXdr(await w.sign(xdr));
      const got = parseSwapReceived(r.result_xdr);
      setDone({ text: `Swapped ${n7(amt)} ${codeOf(from)} for ${got === null ? codeOf(to) : `${n7(got)} ${codeOf(to)}`}.`, hash: r.hash });
      setStage("form"); setFrozen(null); setAmount(""); setDebounced("");
    } catch (e) { setErr(plainSwapError(e)); setStage("form"); setFrozen(null); } finally { setBusy(false); }
  };

  const flip = () => setPair(toKey, fromKey);
  const customOk = custom !== "" && Number(custom) > 0;
  return (
    <>
      <PageHead kicker="Swap" title="Swap" right={<span className="pill gold">{IS_MAINNET ? "Mainnet" : "Testnet"}</span>}>
        Swap one asset for another in a single step. Quasaria asks Stellar for the best route across the order book and native liquidity pools, and you set the most price movement you will accept.
      </PageHead>
      <div className="grid g-2">
        <div className="card glow" data-testid="swap-card">
          {stage === "form" ? (
            <>
              <div className="field"><label>You pay</label>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input className="input mono" style={{ flex: 1, minWidth: 120 }} inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="swap-amount" />
                  <AssetPicker label="From asset" value={fromOpt} options={options} onChange={(o) => pick("from", o)} />
                </div></div>
              <div className="row" style={{ justifyContent: "center", margin: "0 0 8px" }}><button className="btn small ghost" onClick={flip} aria-label="Flip pair" data-testid="swap-flip">⇅ Flip</button></div>
              <div className="field"><label>You receive (estimate)</label>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <div className="input mono" style={{ flex: 1, minWidth: 120 }} data-testid="swap-out">{quote.loading && amt > 0 ? "…" : q ? n7(q.destAmount) : amt > 0 ? "no route" : "—"}</div>
                  <AssetPicker label="To asset" value={toOpt} options={options} onChange={(o) => pick("to", o)} />
                </div></div>
              <dl className="kv" style={{ margin: "6px 0 10px" }}>
                <div><dt>Rate</dt><dd className="mono">{q ? `1 ${codeOf(from)} ≈ ${px(q.rate)} ${codeOf(to)}` : "—"}</dd></div>
                <div><dt>Route</dt><dd className="mono">{q ? [codeOf(from), ...q.path.map(codeOf), codeOf(to)].join(" → ") : "—"}</dd></div>
                <div><dt>Minimum received</dt><dd className="mono" data-testid="swap-min">{q ? `${n7(min)} ${codeOf(to)}` : "—"}</dd></div>
              </dl>
              <div className="field"><label>Slippage limit (most price movement you accept)</label>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {SLIPPAGE_PRESETS.map((p) => <button key={p} className={`btn small ${slip === p && custom === "" ? "" : "ghost"}`} onClick={() => { setSlip(p); setCustom(""); }} data-testid={`slip-${p}`}>{p}%</button>)}
                  <input className={`input mono${customOk ? "" : ""}`} style={{ width: 90 }} inputMode="decimal" placeholder="custom %" value={custom} onChange={(e) => { setCustom(e.target.value); const v = Number(e.target.value); if (v > 0) setSlip(clampSlippage(v)); }} data-testid="slip-custom" aria-label="Custom slippage percent" />
                </div>
                {slip > 5 && <span className="muted l-tiny" style={{ color: "var(--warn, #f5b942)" }}>High slippage: you could receive noticeably less than quoted.</span>}
              </div>
              {err && <div className="notice" role="alert" data-testid="swap-error" style={{ marginBottom: 10 }}>{err}</div>}
              <button className="btn block" onClick={review} disabled={busy || !(amt > 0)} data-testid="swap-review">{busy ? "Checking…" : w.address ? "Review swap" : "Create / sign in to swap"}</button>
              {done && <div className="notice tx-ok" role="status" data-testid="swap-done" style={{ marginTop: 12 }}>{done.text} <TxLink hash={done.hash} net={NETWORK} chars={10} /></div>}
            </>
          ) : frozen && (
            <div data-testid="swap-confirm">
              <h2 style={{ marginTop: 0 }}>Confirm swap</h2>
              <dl className="kv" style={{ margin: "6px 0 10px" }}>
                <div><dt>You pay</dt><dd className="mono">{n7(amt)} {codeOf(from)}</dd></div>
                <div><dt>You receive (estimate)</dt><dd className="mono" data-testid="confirm-out">{n7(frozen.quote.destAmount)} {codeOf(to)}</dd></div>
                <div><dt>Minimum received</dt><dd className="mono" data-testid="confirm-min">{n7(frozen.minOut)} {codeOf(to)}</dd></div>
                <div><dt>Slippage limit</dt><dd className="mono">{frozen.slippage}%</dd></div>
                <div><dt>Route</dt><dd className="mono">{[codeOf(from), ...frozen.quote.path.map(codeOf), codeOf(to)].join(" → ")}</dd></div>
                <div><dt>Network fee</dt><dd className="mono">{n7(frozen.feeXlm)} XLM</dd></div>
                {frozen.reserveXlm > 0 && <div><dt>Reserve</dt><dd>{n7(frozen.reserveXlm)} XLM set aside for a new {frozen.needTrust.map(codeOf).join(", ")} trustline</dd></div>}
              </dl>
              <p className="muted l-tiny">If the price moves so that you would get less than the minimum, the swap fails and nothing changes except the small network fee. Pool swaps charge the pool's 0.30% fee, which goes to liquidity providers, not to Quasaria.</p>
              {err && <div className="notice" role="alert">{err}</div>}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={confirm} disabled={busy} data-testid="swap-confirm-btn">{busy ? "Working…" : "Confirm swap"}</button>
                <button className="btn ghost" onClick={() => { setStage("form"); setFrozen(null); }} disabled={busy} data-testid="swap-cancel-btn">Cancel</button>
              </div>
            </div>
          )}
        </div>
        <div className="card" data-testid="swap-help">
          <h2 style={{ marginTop: 0 }}>How swaps work here</h2>
          <ul className="muted" style={{ paddingLeft: 18, lineHeight: 1.65, margin: 0 }}>
            <li>One Stellar transaction swaps your asset for the one you want. No Quasaria contract sits in between.</li>
            <li>The route can use the order book, native liquidity pools, or both. You see the route before you confirm.</li>
            <li>Your slippage limit becomes a hard minimum in the transaction. If the market moves past it, the swap fails instead of filling worse.</li>
            <li>A missing trustline for the asset you receive is added in the same transaction (0.5 XLM reserve).</li>
            <li>Assets shown without a verified label come from issuers Quasaria hasn't checked. Check the issuer before swapping.</li>
          </ul>
          <p className="muted l-tiny" style={{ marginBottom: 0 }}>{IS_MAINNET ? "Swaps are real mainnet transactions." : "Testnet tokens have no value."} For a specific price, use a limit order on the <Link to="/exchange">Exchange</Link>.</p>
        </div>
      </div>
    </>
  );
}
