import { useEffect, useRef, useState } from "react";
import { useWallet } from "../lib/wallet";
import type { LendingAsset } from "../lib/lending";
import {
  ANCHOR_ASSETS, TERMINAL, TEST_ANCHOR_DOMAIN, loadAnchor, sep10Token, sep24Info, sep24Interactive, sep24Status, sep38Indicative,
  type AnchorAsset, type AnchorToml, type Sep24Tx,
} from "../lib/anchor";

/**
 * Optional "Deposit / withdraw via anchor" panel (SDF test anchor only): SEP-1 discovery,
 * SEP-10 auth signed by the connected wallet, SEP-24 interactive popup (SEP-12 KYC happens
 * inside it) with status polling, and SEP-38 indicative quotes. Degrades gracefully.
 */
export default function AnchorPanel({ selected }: { selected: LendingAsset }) {
  const w = useWallet();
  const [toml, setToml] = useState<AnchorToml | null>(null);
  const [info, setInfo] = useState<Record<string, { dep: boolean; wd: boolean; min?: number; max?: number }>>({});
  const [down, setDown] = useState<string | null>(null);
  const [asset, setAsset] = useState<AnchorAsset>("USDC");
  const [status, setStatus] = useState<string | null>(null);
  const [txs, setTxs] = useState<Sep24Tx | null>(null);
  const [quotes, setQuotes] = useState<Array<{ asset: string; price: string }> | null | undefined>(undefined);
  const token = useRef<{ acct: string; jwt: string } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const selId = selected.id as AnchorAsset;
  const anchorable = (ANCHOR_ASSETS as readonly string[]).includes(selected.id) && selected.testnetKind === "real";

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await loadAnchor();
        const i = await sep24Info(t);
        if (!alive) return;
        setToml(t);
        const m: typeof info = {};
        for (const a of ANCHOR_ASSETS) m[a] = { dep: !!i.deposit[a]?.enabled, wd: !!i.withdraw[a]?.enabled, min: i.deposit[a]?.min_amount, max: i.deposit[a]?.max_amount };
        setInfo(m);
        setQuotes(await sep38Indicative(t, 10));
      } catch (e) {
        if (alive) setDown(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; if (poll.current) clearInterval(poll.current); };
  }, []);
  useEffect(() => { if (anchorable) setAsset(selId); }, [anchorable, selId]);

  const start = async (kind: "deposit" | "withdraw") => {
    if (!w.address) { w.openModal(); return; }
    if (!toml) return;
    // open the popup synchronously (popup blockers), then point it at the anchor URL
    const popup = window.open("", "quasaria-anchor", "width=480,height=720");
    try {
      if (!token.current || token.current.acct !== w.address) {
        setStatus("SEP-10: sign the anchor's login challenge in your wallet (no funds move)…");
        token.current = { acct: w.address, jwt: await sep10Token(toml, w.address, w.sign) };
      }
      setStatus(`SEP-24: opening the ${kind} flow…`);
      const r = await sep24Interactive(toml, token.current.jwt, kind, asset, w.address);
      if (popup) popup.location.href = r.url;
      else window.open(r.url, "_blank", "noopener");
      setStatus(`SEP-24 ${kind} started (id ${r.id.slice(0, 8)}…). Complete it in the anchor window; status updates below.`);
      if (poll.current) clearInterval(poll.current);
      const tick = async () => {
        try {
          const s = await sep24Status(toml, token.current!.jwt, r.id);
          setTxs(s);
          if (TERMINAL.has(s.status) && poll.current) clearInterval(poll.current);
        } catch {
          /* keep polling */
        }
      };
      tick();
      poll.current = setInterval(tick, 5000);
    } catch (e) {
      popup?.close();
      setStatus(`Anchor flow failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="card" style={{ marginTop: 18 }} data-testid="anchor-panel">
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Deposit / withdraw via anchor <span className="muted" style={{ fontSize: "0.75rem" }}>(optional)</span></h2>
        <span className={`pill ${down ? "pink" : toml ? "green" : ""}`}>{down ? "test anchor unavailable" : toml ? `● ${TEST_ANCHOR_DOMAIN}` : "⟳ contacting test anchor…"}</span>
      </div>
      <p className="muted" style={{ fontSize: "0.82rem" }}>
        Move testnet USDC (or the anchor's SRT test token) in and out through the Stellar Development Foundation's <b>test anchor</b>. You log in with a wallet signature (SEP-10), then the anchor's own window handles the rest (SEP-24, including any KYC form). No real money: the test anchor simulates bank transfers. This is only for the anchor session; lending itself needs no login.
      </p>
      {down ? (
        <div className="notice warn">The test anchor couldn't be reached ({down}). Lending works without it.</div>
      ) : (
        <>
          {!anchorable && <div className="notice" style={{ marginBottom: 8 }}>{selected.code}: {selected.testnetKind === "mirror" ? "no anchor, testnet mirror." : selected.testnetKind === "native" ? "native XLM: get it from Friendbot, no anchor needed." : "not served by the test anchor."} Pick USDC below.</div>}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {ANCHOR_ASSETS.map((a) => <button key={a} className={`btn small ${asset === a ? "" : "ghost"}`} onClick={() => setAsset(a)}>{a}{info[a] && !info[a].dep ? " (off)" : ""}</button>)}
            <button className="btn small" disabled={!toml || !info[asset]?.dep} onClick={() => start("deposit")} data-testid="anchor-deposit">Deposit {asset}</button>
            <button className="btn small ghost" disabled={!toml || !info[asset]?.wd} onClick={() => start("withdraw")}>Withdraw {asset}</button>
          </div>
          {info[asset] && <div className="muted" style={{ fontSize: "0.72rem", marginTop: 6 }}>Anchor limits for {asset}: {info[asset].min ?? "?"}–{info[asset].max ?? "?"} per transfer. Your account needs a {asset} trustline. {asset === "SRT" ? "SRT is the anchor's reference token and isn't a lending reserve." : ""}</div>}
          {quotes !== undefined && (
            <div className="muted" style={{ fontSize: "0.72rem", marginTop: 6 }} data-testid="sep38">
              {quotes ? <>SEP-38 indicative quote for selling $10: {quotes.map((x) => `${x.asset.split(":")[1] ?? x.asset} ${Number(x.price).toFixed(4)}/USD`).join(" · ")}. <i>Indicative only; never used to price collateral.</i></> : "SEP-38 quotes: not offered by this anchor."}
            </div>
          )}
          {status && <div className="notice" style={{ marginTop: 8 }}>{status}</div>}
          {txs && <div className="mono" style={{ fontSize: "0.72rem" }}>status: <b>{txs.status}</b>{txs.amount_in ? ` · in ${txs.amount_in}` : ""}{txs.amount_out ? ` · out ${txs.amount_out}` : ""}{txs.message ? ` · ${txs.message}` : ""}{txs.more_info_url && <> · <a href={txs.more_info_url} target="_blank" rel="noreferrer">details</a></>}</div>}
        </>
      )}
    </div>
  );
}
