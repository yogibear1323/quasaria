import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "../lib/wallet";
import { expertContract } from "../lib/config";
import {
  DEMO_CAP_USD, LTV_BPS, PR, STORE_KEY, TYPES, WAITLIST_KEY, estimateYield, fmtUsd, fromStroop, putToWork, readNextId,
  readPosition, readPrtBalance, readReserve, readSharePrice, readTokenized, readXlmPrice, selfAttest, sha256Hex, simulateAppraisal, tokenize,
  withdrawPosition, workingCap, type Position, type PropertyType,
} from "../lib/propertyRoot";
import "../theme/propertyroot.css";

const BASE = import.meta.env.BASE_URL;
const LOGO = `${BASE}brand/propertyroot/option-a-roots-house.svg`;
type Saved = { id?: number; address: string; type: PropertyType; size: number; value?: number; hash?: string; token?: string; owner?: string };
const ls = () => (typeof localStorage === "undefined" ? null : localStorage);
const load = (): Saved => { try { return { address: "", type: "single-family", size: 1800, ...JSON.parse(ls()?.getItem(STORE_KEY) || "{}") }; } catch { return { address: "", type: "single-family", size: 1800 }; } };

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <section className={`pr-step${done ? " done" : ""}${active ? " active" : ""}`} aria-label={`Step ${n}: ${title}`}>
      <header><span className="pr-num">{done ? "✓" : n}</span><h3>{title}</h3></header>
      <div className="pr-step-body">{children}</div>
    </section>
  );
}

function LiveFeeds() {
  const [x, setX] = useState<{ price?: number; ts?: number; share?: number; reserve?: number; err?: string }>({});
  useEffect(() => {
    let on = true;
    Promise.allSettled([readXlmPrice(), readSharePrice(), readReserve()]).then(([p, s, r]) => {
      if (!on) return;
      setX({ price: p.status === "fulfilled" ? p.value.usd : undefined, ts: p.status === "fulfilled" ? p.value.ts : undefined,
        share: s.status === "fulfilled" ? Number(s.value) / 1e7 : undefined, reserve: r.status === "fulfilled" ? fromStroop(r.value) : undefined,
        err: p.status === "rejected" ? "Couldn't reach Stellar testnet RPC right now." : undefined });
    });
    return () => { on = false; };
  }, []);
  return (
    <div className="pr-feeds" data-testid="pr-feeds">
      <div><span>XLM/USD · Reflector</span><b className="mono">{x.price ? `$${x.price.toFixed(4)}` : "—"}</b><small>{x.ts ? `as of ${new Date(x.ts * 1000).toLocaleTimeString()}` : x.err ?? "reading testnet…"}</small></div>
      <div><span>Blend share price</span><b className="mono">{x.share ? x.share.toFixed(7) : "—"}</b><small>XLM per vault share, grows with interest</small></div>
      <div><span>Demo liquidity reserve</span><b className="mono">{x.reserve !== undefined ? `${x.reserve.toLocaleString("en-US", { maximumFractionDigits: 0 })} XLM` : "—"}</b><small>stands in for a lender</small></div>
    </div>
  );
}

function Demo() {
  const w = useWallet();
  const [s, setS] = useState<Saved>(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; hash?: string } | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [prt, setPrt] = useState<number | null>(null);
  const [amt, setAmt] = useState(100);
  const appr = useMemo(() => simulateAppraisal(s), [s]);
  const unit = TYPES.find((t) => t.id === s.type)?.unit ?? "sqft";
  const mine = s.owner && w.address === s.owner;
  const attested = Boolean(mine && s.id && s.hash);
  const tokenized = Boolean(mine && s.token);
  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }, [s]);

  const refresh = useCallback(async () => {
    if (!mine || !s.id) return;
    try {
      if (await readTokenized(s.id)) {
        const p = await readPosition(s.id);
        setPos(p);
        if (!s.token) setS((o) => ({ ...o, token: p.property.token }));
        setPrt(fromStroop(await readPrtBalance(p.property.token, w.address!)));
      }
    } catch { /* not yet on chain */ }
  }, [mine, s.id, s.token, w.address]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 20_000); return () => clearInterval(t); }, [refresh]);

  const run = async (label: string, f: () => Promise<{ hash: string; result: unknown }>, after?: (r: unknown) => void) => {
    setBusy(label); setMsg(null);
    try { const r = await f(); after?.(r.result); setMsg({ kind: "ok", text: `${label}: confirmed on testnet.`, hash: r.hash }); await refresh(); }
    catch (e) { setMsg({ kind: "err", text: `${label} failed: ${(e as Error).message}` }); }
    finally { setBusy(null); }
  };

  const doAttest = () => run("Record simulated appraisal", async () => {
    const id = Number(await readNextId());
    const hash = await sha256Hex(`propertyroot-demo|${w.address}|${s.address}|${s.type}|${s.size}|${appr.value}`);
    const r = await selfAttest(w.address!, w.sign, id, appr.value, hash);
    setS((o) => ({ ...o, id, hash, value: appr.value, owner: w.address!, token: undefined }));
    return r;
  });
  const doTokenize = () => run("Tokenize", () => tokenize(w.address!, w.sign, s.id!), (tok) => setS((o) => ({ ...o, token: String(tok) })));
  const doWork = () => run("Put to work", () => putToWork(w.address!, w.sign, s.id!, amt));
  const doWithdraw = () => run("Withdraw", () => withdrawPosition(w.address!, w.sign, s.id!));
  const reset = () => { setS({ address: "", type: "single-family", size: 1800 }); setPos(null); setPrt(null); setMsg(null); };

  const working = pos ? fromStroop(pos.property.prt_working) : 0;
  return (
    <div className="pr-demo" id="demo">
      <div className="pr-wallet">
        {w.address ? (
          <span>Connected <b className="mono">{w.address.slice(0, 5)}…{w.address.slice(-4)}</b> on testnet{w.wrongNetwork ? " · switch Freighter to Testnet" : ""}</span>
        ) : (
          <>
            <button className="pr-btn" onClick={() => w.connect()} disabled={w.connecting}>{w.available ? "Connect Freighter" : "Connect wallet"}</button>
            <button className="pr-btn ghost" onClick={() => w.openModal()}>Use a testnet key instead</button>
            <span className="muted">Needs a testnet account with a little XLM for fees (fund it free with Friendbot).</span>
          </>
        )}
      </div>
      <LiveFeeds />
      <div className="pr-steps">
        <Step n={1} title="Appraise & verify (simulated)" done={attested} active={!attested}>
          <p className="pr-sim">Simulated: no real appraiser, title search or KYC happens. Your own wallet signs a demo appraisal, flagged <code>simulated</code> on-chain.</p>
          <div className="pr-form">
            <label>Property address<input value={s.address} placeholder="123 Mesa Verde Rd, Sedona AZ" onChange={(e) => setS({ ...s, address: e.target.value })} disabled={attested} /></label>
            <label>Type<select value={s.type} onChange={(e) => setS({ ...s, type: e.target.value as PropertyType })} disabled={attested}>{TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
            <label>Size ({unit})<input type="number" min={1} value={s.size} onChange={(e) => setS({ ...s, size: Number(e.target.value) })} disabled={attested} /></label>
          </div>
          <div className="pr-appraisal">
            <div><span>Simulated appraisal</span><b className="mono">{fmtUsd(s.value ?? appr.value)}</b>{appr.capped && <small>capped at the {fmtUsd(DEMO_CAP_USD)} demo limit</small>}</div>
            <div><span>Title check (simulated)</span><b>{appr.titleVerified ? "✓ verified" : "needs an address"}</b></div>
            <div><span>KYC (simulated)</span><b>✓ verified</b></div>
          </div>
          {!attested && <button className="pr-btn" disabled={!w.address || !appr.titleVerified || appr.value <= 0 || !!busy} onClick={doAttest}>{busy === "Record simulated appraisal" ? "Signing…" : "Record attestation on-chain"}</button>}
          {attested && <p className="muted">Property #{s.id} attested · appraisal hash <code>{s.hash?.slice(0, 16)}…</code></p>}
        </Step>
        <Step n={2} title="Tokenize into a pRT vault token" done={tokenized} active={attested && !tokenized}>
          <p>The vault mints <b>pRT-{s.id ?? "id"}</b>, a SEP-41 token. 1 pRT = $1 of the working value, which is {LTV_BPS / 100}% of the appraisal (the LTV cap).</p>
          <p className="mono pr-big">{fmtUsd(workingCap(s.value ?? appr.value))} <small>working value</small></p>
          {!tokenized && <button className="pr-btn" disabled={!attested || !!busy} onClick={doTokenize}>{busy === "Tokenize" ? "Signing…" : `Mint pRT-${s.id ?? ""}`}</button>}
          {tokenized && <p className="muted">Token <a href={expertContract(s.token!)} target="_blank" rel="noreferrer" className="mono">{s.token!.slice(0, 6)}…{s.token!.slice(-4)}</a> · your balance <b className="mono">{prt !== null ? prt.toLocaleString("en-US") : "…"} pRT</b></p>}
        </Step>
        <Step n={3} title="Earn compounded lending yield (Blend)" done={false} active={tokenized}>
          <p>Choose how many pRT to put to work. The vault converts that dollar value to XLM at the Reflector price and supplies it to Blend's testnet XLM pool. Interest compounds through Blend's rate, so the share price only goes up while borrowers pay.</p>
          <p className="pr-note"><b>This is lending yield</b>, paid by Blend borrowers. It is not rent or property appreciation.</p>
          <div className="pr-form">
            <label>pRT to put to work (demo limit $500)<input type="number" min={1} max={500} value={amt} onChange={(e) => setAmt(Math.max(1, Math.min(500, Number(e.target.value))))} /></label>
          </div>
          <div className="pr-row">
            <button className="pr-btn" disabled={!tokenized || !!busy} onClick={doWork}>{busy === "Put to work" ? "Signing…" : "Put to work"}</button>
            <button className="pr-btn ghost" disabled={!tokenized || !pos || pos.property.shares === 0n || !!busy} onClick={doWithdraw}>{busy === "Withdraw" ? "Signing…" : "Withdraw + collect yield"}</button>
          </div>
          {pos && (
            <div className="pr-appraisal">
              <div><span>pRT working</span><b className="mono">{working.toLocaleString("en-US")}</b></div>
              <div><span>In Blend</span><b className="mono">{fromStroop(pos.value_xlm).toFixed(4)} XLM</b></div>
              <div><span>Interest so far</span><b className="mono">{fromStroop(pos.accrued_yield_xlm).toFixed(7)} XLM</b><small>paid {fromStroop(pos.property.yield_paid_xlm).toFixed(7)} XLM</small></div>
            </div>
          )}
        </Step>
      </div>
      {msg && <p className={`pr-msg ${msg.kind}`} role="status">{msg.text} {msg.hash && <a href={`https://stellar.expert/explorer/testnet/tx/${msg.hash}`} target="_blank" rel="noreferrer">View transaction</a>}</p>}
      {s.id && <button className="pr-link" onClick={reset}>Start over with a new property</button>}
    </div>
  );
}

function Calculator() {
  const [value, setValue] = useState(450_000);
  const [workPct, setWorkPct] = useState(50);
  const [apr, setApr] = useState(3);
  const [years, setYears] = useState(5);
  const r = useMemo(() => estimateYield({ value, ltvPct: LTV_BPS / 100, workPct, aprPct: apr, years }), [value, workPct, apr, years]);
  const W = 640, H = 150, max = Math.max(1, ...r.series);
  const d = r.series.map((v, i) => `${i ? "L" : "M"}${(i / Math.max(1, r.series.length - 1)) * W},${H - (v / max) * (H - 10)}`).join(" ");
  return (
    <div className="pr-card" data-testid="pr-calc">
      <p className="pr-est">Estimate only. Blend rates change constantly (the testnet and mainnet XLM pools have recently paid well under 1%). Nothing here is a promise or advice.</p>
      <div className="pr-form">
        <label>Property value <output>{fmtUsd(value)}</output><input type="range" min={50_000} max={2_000_000} step={10_000} value={value} onChange={(e) => setValue(+e.target.value)} /></label>
        <label>Share of working value put to work <output>{workPct}%</output><input type="range" min={5} max={100} step={5} value={workPct} onChange={(e) => setWorkPct(+e.target.value)} /></label>
        <label>Assumed lending APR <output>{apr.toFixed(1)}%</output><input type="range" min={0} max={10} step={0.1} value={apr} onChange={(e) => setApr(+e.target.value)} /></label>
        <label>Years <output>{years}</output><input type="range" min={1} max={20} value={years} onChange={(e) => setYears(+e.target.value)} /></label>
      </div>
      <div className="pr-appraisal">
        <div><span>Put to work</span><b className="mono">{fmtUsd(r.working)}</b><small>{LTV_BPS / 100}% LTV × {workPct}%</small></div>
        <div><span>Estimated interest</span><b className="mono">{fmtUsd(r.earned)}</b><small>APY {r.apy.toFixed(2)}%, monthly compounding</small></div>
        <div><span>From compounding</span><b className="mono">{fmtUsd(r.compoundBonus)}</b><small>vs simple interest</small></div>
      </div>
      <svg className="pr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Estimated interest over time"><path d={`${d} L${W},${H} L0,${H} Z`} fill="rgba(232,163,61,.22)" /><path d={d} fill="none" stroke="#B8603A" strokeWidth="2.5" /></svg>
    </div>
  );
}

function Waitlist() {
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState<string | null>(() => ls()?.getItem(WAITLIST_KEY) ?? null);
  return (
    <div className="pr-card">
      {saved ? <p>You're on this device's waitlist as <b>{saved}</b>. <button className="pr-link" onClick={() => { localStorage.removeItem(WAITLIST_KEY); setSaved(null); }}>Remove</button></p> : (
        <form className="pr-row" onSubmit={(e) => { e.preventDefault(); if (/^\S+@\S+\.\S+$/.test(email)) { localStorage.setItem(WAITLIST_KEY, email); setSaved(email); } }}>
          <input className="pr-input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <button className="pr-btn" type="submit">Join the waitlist</button>
        </form>
      )}
      <p className="muted pr-small">Saved only in this browser. Nothing is sent anywhere yet; there's no server behind this demo.</p>
    </div>
  );
}

export default function PropertyRoot() {
  const c = PR.contracts;
  return (
    <div className="pr-page">
      <div className="pr-banner">Testnet demo · unaudited · <b>not legal title</b>. Appraisal, title and KYC are simulated. No real property or money is involved.</div>
      <header className="pr-hero">
        <img src={LOGO} alt="PropertyRoot logo: roots growing from the Quasaria Q into a small house" className="pr-logo" width={132} height={132} />
        <div>
          <div className="kicker">Quasaria · PropertyRoot</div>
          <h1>Put your property to work</h1>
          <p>PropertyRoot turns the appraised value of a home or land into a Stellar vault token, then puts part of that value to work in Blend lending, where interest compounds. Built only on Stellar: Soroban contracts, SEP-41 tokens, Blend, Reflector and Freighter.</p>
          <a className="pr-btn" href="#demo">Try the testnet demo</a>
        </div>
      </header>

      <section className="pr-sec">
        <h2>How it works</h2>
        <div className="pr-how">
          <div className="pr-card"><span className="pr-num">1</span><h3>Appraise & verify</h3><p>An appraiser values the property and title/KYC are checked off-chain. A hash of the appraisal and its value are recorded in the attestation registry. <em>Simulated in this demo.</em></p></div>
          <div className="pr-card"><span className="pr-num">2</span><h3>Tokenize</h3><p>The property vault mints a pRT token for up to {LTV_BPS / 100}% of the value (the LTV cap). A new appraisal can raise or lower it.</p></div>
          <div className="pr-card"><span className="pr-num">3</span><h3>Earn & compound</h3><p>pRT you put to work is matched with XLM, priced by Reflector, and supplied to Blend. Borrowers' interest compounds into the vault's share price.</p></div>
        </div>
      </section>

      <section className="pr-sec"><h2>Live testnet demo</h2><Demo /></section>
      <section className="pr-sec"><h2>Yield calculator <small>(estimate)</small></h2><Calculator /></section>

      <section className="pr-sec" id="risks">
        <h2>Risks and requirements</h2>
        <div className="pr-how">
          <div className="pr-card"><h3>Legal</h3><p>A token is not a deed. A real version needs the title held by a trust or company, licensed appraisers, KYC, and likely securities registration or an exemption. Nothing here gives anyone rights to a property.</p></div>
          <div className="pr-card"><h3>Appraisal</h3><p>An appraisal is an opinion and goes stale. If a new appraisal comes in lower, the vault blocks new deployments until it's back under the cap.</p></div>
          <div className="pr-card"><h3>Oracle</h3><p>Reflector's XLM/USD price sets how much XLM is supplied. Prices older than 30 minutes are rejected, but a wrong price would still misprice deposits.</p></div>
          <div className="pr-card"><h3>Liquidation & lending</h3><p>In a real product the working capital is borrowed against your pRT, so a value drop could mean liquidation. Blend can also have high utilization, bad debt or bugs that delay or cut withdrawals. Rates are variable.</p></div>
        </div>
      </section>

      <section className="pr-sec"><h2>Join the waitlist</h2><Waitlist /></section>

      <section className="pr-sec">
        <h2>Contracts on testnet</h2>
        <ul className="pr-contracts">
          <li>Attestation registry <a href={expertContract(c.attestationRegistry)} target="_blank" rel="noreferrer" className="mono">{c.attestationRegistry}</a></li>
          <li>Property vault <a href={expertContract(c.propertyVault)} target="_blank" rel="noreferrer" className="mono">{c.propertyVault}</a></li>
          <li>Blend adapter <a href={expertContract(c.blendAdapter)} target="_blank" rel="noreferrer" className="mono">{c.blendAdapter}</a></li>
          <li>Blend pool (testnet) <a href={expertContract(PR.external.blendPool)} target="_blank" rel="noreferrer" className="mono">{PR.external.blendPool}</a></li>
          <li>Reflector oracle (testnet) <a href={expertContract(PR.external.reflector)} target="_blank" rel="noreferrer" className="mono">{PR.external.reflector}</a></li>
        </ul>
        <p className="muted pr-small">Source: <a href="https://github.com/yogibear1323/propertyroot" target="_blank" rel="noreferrer">github.com/yogibear1323/propertyroot</a></p>
      </section>
    </div>
  );
}
