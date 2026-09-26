/**
 * Mint / Redeem QFX: 1 QFX = 1 XLM, fully backed.
 * XLM in -> QFX out (qfx.deposit) and back (qfx.redeem). Reserve and supply
 * are read live from the QFX contract's `reserves()` view on Soroban testnet.
 */
import { useEffect, useState } from "react";
import { Stat, Tabs, TxStatus, useTx } from "./ui";
import { CONTRACTS, CONTRACTS_CONFIGURED, expertContract } from "../lib/config";
import { readMintBalances, readQfxReserves, type QfxReserves } from "../lib/chain";
import { addr, i128, invokeContract } from "../lib/soroban";
import { fmt, parseUnits } from "../lib/format";
import { DEMO_QFX } from "../lib/demo";

type Mode = "mint" | "redeem";
/** Keep some XLM for the account minimum balance and fees. */
const XLM_BUFFER = 5;

export function useQfxReserves(refresh = 0) {
  const [s, setS] = useState<{ data: QfxReserves | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: CONTRACTS_CONFIGURED });
  useEffect(() => {
    if (!CONTRACTS_CONFIGURED) return;
    let alive = true;
    setS((x) => ({ ...x, loading: true }));
    readQfxReserves()
      .then((data) => alive && setS({ data, error: null, loading: false }))
      .catch((e) => alive && setS({ data: null, error: (e as Error).message, loading: false }));
    return () => {
      alive = false;
    };
  }, [refresh]);
  return s;
}

export function ReservesView({ r, loading, error }: { r: QfxReserves | null; loading: boolean; error: string | null }) {
  const reserve = r?.xlmReserve ?? (CONTRACTS_CONFIGURED ? null : DEMO_QFX.xlmReserve);
  const supply = r?.totalSupply ?? (CONTRACTS_CONFIGURED ? null : DEMO_QFX.totalSupply);
  const ratio = reserve !== null && supply ? (reserve / supply) * 100 : null;
  const equal = r ? r.raw.xlmReserve === r.raw.totalSupply : null;
  return (
    <div data-testid="qfx-reserves">
      <div className="grid g-2">
        <Stat label="XLM reserve (on-chain)" value={<span data-testid="qfx-reserve">{reserve !== null ? fmt(reserve, 7) : loading ? "reading…" : "—"}</span>} sub="native XLM held by the QFX contract" className="gold" />
        <Stat label="QFX total supply" value={<span data-testid="qfx-supply">{supply !== null ? fmt(supply, 7) : loading ? "reading…" : "—"}</span>} sub="every QFX in existence" className="gold" />
      </div>
      <div className="row between" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
        <span className={`pill ${r?.fullyBacked === false ? "pink" : "green"}`} data-testid="qfx-backing">
          {ratio !== null ? `Backing ${fmt(ratio, 2)}%` : "Backing —"}
          {equal === true ? " · reserve = supply" : r && r.surplus > 0 ? ` · +${fmt(r.surplus, 7)} XLM surplus` : ""}
        </span>
        {r && <span className="muted" style={{ fontSize: "0.75rem" }}>{fmt(r.circulating, 2)} circulating · {fmt(r.rewardReserve, 2)} in the holder-yield reserve</span>}
      </div>
      {error && <div className="notice warn" style={{ marginTop: 8 }}>Could not read reserves from Soroban RPC ({error}).</div>}
      {!CONTRACTS_CONFIGURED && <div className="notice" style={{ marginTop: 8 }}>Offline demo numbers.</div>}
    </div>
  );
}

export default function MintRedeem() {
  const tx = useTx();
  const [mode, setMode] = useState<Mode>("mint");
  const [amount, setAmount] = useState("10");
  const [refresh, setRefresh] = useState(0);
  const res = useQfxReserves(refresh);
  const [bal, setBal] = useState<{ xlm: number; qfx: number } | null>(null);
  const who = tx.wallet.address ?? "";

  useEffect(() => {
    if (!CONTRACTS_CONFIGURED || !who) return setBal(null);
    let alive = true;
    readMintBalances(who).then((b) => alive && setBal(b)).catch(() => alive && setBal(null));
    return () => {
      alive = false;
    };
  }, [who, refresh]);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && /^\d*(\.\d{0,7})?$/.test(amount.trim());
  const have = mode === "mint" ? bal?.xlm : bal?.qfx;
  const over = have !== undefined && valid && n > (mode === "mint" ? Math.max(0, have - XLM_BUFFER) : have);
  const [inSym, outSym] = mode === "mint" ? ["XLM", "QFX"] : ["QFX", "XLM"];

  const submit = () =>
    tx.run(mode === "mint" ? "Mint QFX" : "Redeem QFX", async () => {
      const units = parseUnits(amount);
      const r = await invokeContract(tx.wallet.address!, tx.wallet.sign, CONTRACTS.qfx, mode === "mint" ? "deposit" : "redeem", [addr(tx.wallet.address!), i128(units)]);
      setRefresh((x) => x + 1);
      return `tx ${r.hash}`;
    });

  return (
    <div className="card glow" data-testid="mint-redeem">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Mint / Redeem QFX</h2>
        <span className="pill gold" data-testid="peg-label">1 QFX = 1 XLM, fully backed</span>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Deposit XLM to mint the same amount of QFX; redeem QFX to get the same amount of XLM back. No fee, no price impact: the contract only creates QFX when XLM comes in and destroys it when XLM goes out, so the XLM reserve always equals the QFX supply.
      </p>
      <Tabs value={mode} onChange={(m) => setMode(m)} options={[{ v: "mint", label: "Mint · XLM → QFX" }, { v: "redeem", label: "Redeem · QFX → XLM" }]} />
      <div className="field" style={{ marginTop: 12 }}>
        <label className="row between">
          <span>You pay ({inSym})</span>
          {have !== undefined && (
            <button className="btn small ghost" type="button" onClick={() => setAmount(String(Math.max(0, Math.floor((mode === "mint" ? have - XLM_BUFFER : have) * 1e7) / 1e7)))}>
              Max {fmt(have, 4)}
            </button>
          )}
        </label>
        <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="mint-amount" />
      </div>
      <div className="row between" style={{ fontSize: "0.9rem", margin: "6px 0 12px" }}>
        <span className="muted">You receive</span>
        <b className="mono" data-testid="mint-receive">{valid ? fmt(n, 7) : "—"} {outSym}</b>
      </div>
      {over && <div className="notice warn">Amount exceeds your {inSym} balance{mode === "mint" ? ` (keeping ${XLM_BUFFER} XLM for the account minimum and fees)` : ""}. {mode === "redeem" ? "The contract rejects redeeming more than you hold." : ""}</div>}
      <button className="btn block" disabled={tx.busy || !valid || over} onClick={submit} data-testid="mint-submit">
        {mode === "mint" ? `Mint ${valid ? fmt(n, 2) : ""} QFX` : `Redeem for ${valid ? fmt(n, 2) : ""} XLM`}
      </button>
      {who && bal && <p className="muted mono" style={{ fontSize: "0.75rem", marginTop: 8 }} data-testid="mint-balances">Wallet: {fmt(bal.xlm, 4)} XLM · {fmt(bal.qfx, 4)} QFX</p>}
      <TxStatus status={tx.status} />
      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Proof of reserves <span className="pill green" style={{ fontSize: "0.65rem" }}>{res.loading ? "⟳ reading testnet…" : res.data ? "● live · Soroban testnet" : "—"}</span></h3>
        <ReservesView r={res.data} loading={res.loading} error={res.error} />
        <p className="muted" style={{ fontSize: "0.72rem", marginTop: 8 }}>
          Read from <a className="mono" href={expertContract(CONTRACTS.qfx)} target="_blank" rel="noreferrer">reserves()</a> on the QFX contract: its live XLM balance in the native XLM Stellar Asset Contract vs. total QFX supply. There is no admin mint.
        </p>
      </div>
      <div className="risk" style={{ marginTop: 12, fontSize: "0.8rem" }}>
        <strong>Testnet only · unaudited.</strong> The 1:1 peg is enforced by the contract code, but smart-contract bugs, RPC outages or network issues could still delay or prevent redemption. Testnet XLM has no value. Not financial advice.
      </div>
    </div>
  );
}
