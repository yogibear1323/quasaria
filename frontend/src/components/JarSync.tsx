import { useCallback, useEffect, useRef, useState } from "react";
import { BASE_FEE } from "@stellar/stellar-sdk";
import { NETWORK, NETWORK_PASSPHRASE } from "../lib/config";
import { fetchBaseReserve, parseAccount, type HAccount } from "../lib/account";
import { horizon, submitSignedXdr } from "../lib/stellar";
import { explorerTxUrl } from "../lib/explorer";
import type { Ledger } from "../lib/jarsLedger";
import {
  JAR_SYNC_ENABLED, MAX_CHUNKS, RESERVE_PER_ENTRY_XLM, affordProblem, buildClearTx, buildSyncTx, existingChunkCount, hasSyncHeader,
  mergeLedgers, openLedger, passphraseProblem, readSyncEntries, sealLedger, syncCost, type MergeResult, type SyncCost,
} from "../lib/jarsSync";

export type SyncReview = { kind: "sync" | "clear"; cost: SyncCost; header?: Uint8Array; chunks?: Uint8Array[]; ledger?: Ledger };
export type SyncViewState = {
  remote: boolean; unlocked: boolean; entries: number; busy: boolean;
  error: string | null; info: string | null; merge: MergeResult | null; review: SyncReview | null; lastTx: string | null;
};
export type SyncViewActions = {
  setup: (p: string, c: string) => void; unlock: (p: string) => void; lock: () => void;
  saveMerge: () => void; dismissMerge: () => void; prepare: (kind: "sync" | "clear") => void; confirm: () => void; cancel: () => void;
};

const x = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM`;
export const WARNING = "If you forget this passphrase, your synced jars can't be recovered by anyone, including Quasaria. Your USTRY itself is never at risk: it stays in your wallet.";

/** Pure view so every state can be rendered and tested without a browser. */
export function JarSyncView({ s, a }: { s: SyncViewState; a: SyncViewActions }) {
  const [p, setP] = useState(""), [c, setC] = useState("");
  const submit = () => { if (s.remote) a.unlock(p); else a.setup(p, c); setP(""); setC(""); };
  return (
    <div className="card jar-sync" data-testid="jar-sync">
      <h3>Sync across devices</h3>
      {!s.unlocked ? (
        <>
          <p className="muted small" data-testid="jar-sync-intro">
            {s.remote ? "Synced jars were found on your account. Enter your sync passphrase to load and merge them with the jars on this device."
              : `Save your jars, encrypted, on your own Stellar account so they show up on any device you sign in on. Each saved entry locks ${RESERVE_PER_ENTRY_XLM} XLM of reserve (about 2 XLM for a couple of jars, ${MAX_CHUNKS / 2} XLM at most), returned if you remove the data.`}
          </p>
          <div className="notice" role="note" data-testid="jar-sync-warning">{WARNING}</div>
          <div className="jar-actions">
            <input className="input" type="password" autoComplete={s.remote ? "current-password" : "new-password"} aria-label="Sync passphrase" placeholder="Sync passphrase (8+ characters)" value={p} onChange={(e) => setP(e.target.value)} data-testid="jar-sync-pass" />
            {!s.remote && <input className="input" type="password" autoComplete="new-password" aria-label="Confirm sync passphrase" placeholder="Confirm passphrase" value={c} onChange={(e) => setC(e.target.value)} data-testid="jar-sync-confirm" />}
            <button className="btn small" disabled={s.busy} data-testid="jar-sync-unlock" onClick={submit}>{s.remote ? "Unlock" : "Set passphrase"}</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small" data-testid="jar-sync-status">
            Unlocked for this tab only (the passphrase is never saved). {s.remote ? `${s.entries} sync entries on your account.` : "Nothing synced to your account yet."}
          </p>
          {s.merge && s.merge.changedLocal && (
            <div className="notice" data-testid="jar-sync-merge">
              <b>Jars from your account differ from this device.</b>{" "}
              {[s.merge.added.length && `Add ${s.merge.added.join(", ")}`, s.merge.updated.length && `Update ${s.merge.updated.join(", ")} (newer on the other device)`, s.merge.removed.length && `Remove ${s.merge.removed.join(", ")} (closed on another device)`].filter(Boolean).join(" · ")}.
              <div className="jar-actions"><button className="btn small" data-testid="jar-sync-merge-save" onClick={a.saveMerge}>Save merged jars here</button><button className="btn small ghost" onClick={a.dismissMerge}>Not now</button></div>
            </div>
          )}
          {!s.review && (
            <div className="jar-actions">
              <button className="btn small" data-testid="jar-sync-now" disabled={s.busy || !!s.merge?.changedLocal} onClick={() => a.prepare("sync")}>Sync now</button>
              {s.remote && <button className="btn small ghost" data-testid="jar-sync-clear" disabled={s.busy} onClick={() => a.prepare("clear")}>Remove synced data</button>}
              <button className="btn small ghost" onClick={a.lock}>Lock</button>
              {s.merge?.changedLocal && <span className="muted small">Save the merge first so nothing on your account is overwritten.</span>}
            </div>
          )}
          {s.review && (
            <div className="jar-review" data-testid="jar-sync-review">
              <h4>{s.review.kind === "sync" ? "Review: sync jars to your account" : "Review: remove synced jar data"}</h4>
              <dl className="jar-dl">
                <div><dt>Entries after</dt><dd className="mono">{s.review.kind === "sync" ? s.review.cost.entries : 0}</dd></div>
                <div data-testid="jar-sync-reserve"><dt>Reserve change</dt><dd className="mono">{s.review.cost.reserveDeltaXlm > 0 ? `+${x(s.review.cost.reserveDeltaXlm)} locked` : s.review.cost.reserveDeltaXlm < 0 ? `${x(-s.review.cost.reserveDeltaXlm)} returned to you` : "no change"} ({RESERVE_PER_ENTRY_XLM} XLM per entry)</dd></div>
                <div data-testid="jar-sync-fee"><dt>Network fee</dt><dd className="mono">{x(s.review.cost.feeXlm)}</dd></div>
              </dl>
              <p className="muted small">Data is stored publicly but encrypted; only your passphrase can read it. You'll approve the signature next.</p>
              <div className="jar-actions">
                <button className="btn" data-testid="jar-sync-confirm-sign" disabled={s.busy} onClick={a.confirm}>Confirm & sign</button>
                <button className="btn ghost" onClick={a.cancel}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      {s.error && <div className="notice neg" role="alert" data-testid="jar-sync-error">{s.error}</div>}
      {s.info && <div className="muted small" data-testid="jar-sync-info">{s.info}{s.lastTx && <> · <a href={explorerTxUrl(s.lastTx) ?? "#"} target="_blank" rel="noreferrer">StellarChain.io</a></>}</div>}
    </div>
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Container: holds the passphrase in memory only, reads/merges on load, and builds the user-signed sync tx. */
export function JarSync(p: { address: string; acct: HAccount | null; ledger: Ledger; persist: (l: Ledger) => void; sign: (xdr: string) => Promise<string>; refresh: () => Promise<void> }) {
  const pass = useRef<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [info, setInfo] = useState<string | null>(null), [lastTx, setLastTx] = useState<string | null>(null);
  const [merge, setMerge] = useState<MergeResult | null>(null);
  const [review, setReview] = useState<SyncReview | null>(null);
  const data = p.acct?.data; const remote = hasSyncHeader(data);
  const entries = existingChunkCount(data) + (remote ? 1 : 0);
  const dataKey = JSON.stringify(data ?? {});

  const lock = useCallback(() => { pass.current = null; setUnlocked(false); setMerge(null); setReview(null); setInfo(null); }, []);
  useEffect(() => lock, [p.address, lock]); // never carry a passphrase across accounts

  const loadRemote = useCallback(async (pw: string): Promise<Ledger | null> => {
    if (!hasSyncHeader(data)) return null;
    const e = readSyncEntries(data);
    if (!e) throw new Error("The synced data on your account is incomplete. Sync again from a device that has your jars.");
    try { return await openLedger(e.header, e.chunks, pw, p.address); } catch { throw new Error("Wrong passphrase, or the synced data is damaged."); }
  }, [dataKey, p.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const doMerge = useCallback(async (pw: string) => {
    const r = await loadRemote(pw);
    if (!r) { setMerge(null); return; }
    const m = mergeLedgers(p.ledger, r);
    setMerge(m);
    setInfo(m.changedLocal ? null : m.changedRemote ? "This device has newer jars than your account. Sync now to update it." : "Your jars match your account.");
  }, [loadRemote, p.ledger]);

  // Re-merge when the on-chain copy changes (e.g. another device synced) while unlocked.
  useEffect(() => { if (pass.current) doMerge(pass.current).catch((e) => setError(msg(e))); }, [dataKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const a: SyncViewActions = {
    setup: (pw, c) => { setError(null); const pr = passphraseProblem(pw, c); if (pr) return setError(pr); pass.current = pw; setUnlocked(true); setInfo("Passphrase set for this tab. Sync now to save your jars to your account."); },
    unlock: (pw) => { setError(null); const pr = passphraseProblem(pw); if (pr) return setError(pr);
      setBusy(true); doMerge(pw).then(() => { pass.current = pw; setUnlocked(true); }).catch((e) => setError(msg(e))).finally(() => setBusy(false)); },
    lock,
    saveMerge: () => { if (!merge) return; p.persist(merge.ledger); setMerge({ ...merge, changedLocal: false }); setInfo(merge.changedRemote ? "Merged jars saved on this device. Sync now to update your account too." : "Merged jars saved on this device."); },
    dismissMerge: () => { setMerge(null); setInfo("Merge skipped. Sync is paused until you unlock again and save the merge."); lock(); },
    prepare: (kind) => { setError(null); setInfo(null); setBusy(true); (async () => {
      const [reserve] = await Promise.all([fetchBaseReserve(NETWORK)]);
      if (!p.acct) throw new Error("Couldn't load your account; try again");
      const v = parseAccount(p.acct, NETWORK, reserve); const avail = v.exists ? v.native.available : null;
      const existing = existingChunkCount(data);
      if (kind === "clear") {
        const cost: SyncCost = { entries: 0, newEntries: 0, reserveDeltaXlm: -entries * RESERVE_PER_ENTRY_XLM, feeXlm: (entries * Number(BASE_FEE)) / 1e7 };
        const pr = affordProblem(cost, avail); if (pr) throw new Error(pr);
        return setReview({ kind, cost });
      }
      const ledger = p.ledger; // sync is disabled until any pending merge is saved, so local already includes the account's jars
      const { header, chunks } = await sealLedger(ledger, pass.current!, p.address);
      const cost = syncCost(chunks.length, existing, Number(BASE_FEE), remote);
      const pr = affordProblem(cost, avail); if (pr) throw new Error(pr);
      setReview({ kind, cost, header, chunks, ledger });
    })().catch((e) => setError(msg(e))).finally(() => setBusy(false)); },
    confirm: () => { const r = review!; setError(null); setBusy(true); (async () => {
      const seq = (await horizon.loadAccount(p.address)).sequenceNumber();
      const xdr = r.kind === "sync"
        ? buildSyncTx({ source: p.address, sequence: seq, passphrase: NETWORK_PASSPHRASE, header: r.header!, chunks: r.chunks!, existingChunks: existingChunkCount(data) })
        : buildClearTx({ source: p.address, sequence: seq, passphrase: NETWORK_PASSPHRASE, data });
      const res = await submitSignedXdr(await p.sign(xdr));
      setReview(null); setMerge(null); setLastTx(res.hash);
      setInfo(r.kind === "sync" ? "Jars synced to your account." : "Synced data removed; its reserve is back in your balance.");
      if (r.kind === "clear") lock();
      await p.refresh();
    })().catch((e) => { setReview(null); setError(`Sync failed: ${msg(e)}. Nothing was resent; check your account before trying again.`); }).finally(() => setBusy(false)); },
    cancel: () => setReview(null),
  };

  if (!JAR_SYNC_ENABLED) return null;
  return <JarSyncView s={{ remote, unlocked, entries, busy, error, info, merge, review, lastTx }} a={a} />;
}
