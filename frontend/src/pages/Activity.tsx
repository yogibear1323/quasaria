import { NETWORK, IS_MAINNET } from "../lib/config";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { TxLink } from "../components/TxLink";
import { useWallet } from "../lib/wallet";
import { useAsync } from "../lib/useAsync";
import { ACTIVITY_FILTERS, fetchActivity, filterItems, type ActivityItem, type ActivityKind } from "../lib/activity";

const NET = NETWORK;
const PILL: Record<ActivityKind, string> = { swap: "cyan", order: "gold", pool: "green", reward: "gold", referral: "pink", payment: "" };
const KIND_LABEL: Record<ActivityKind, string> = { swap: "Swap", order: "Order", pool: "Pool", reward: "Reward", referral: "Referral", payment: "Payment" };

function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ActivityList({ items, loading, error, empty }: { items: ActivityItem[]; loading: boolean; error: string | null; empty: string }) {
  if (loading) return <p className="muted" data-testid="act-loading">Reading Horizon…</p>;
  if (error) return <p className="neg" role="alert" data-testid="act-error">Could not read activity: {error}</p>;
  if (!items.length) return <p className="muted" data-testid="act-empty">{empty}</p>;
  return (
    <ul className="act-list" data-testid="act-list">
      {items.map((i) => (
        <li key={i.id} className="act-row" data-testid="act-row" data-kind={i.kind}>
          <span className={`pill ${PILL[i.kind]}`}>{KIND_LABEL[i.kind]}</span>
          <span className="act-main"><b>{i.title}</b><span className="muted act-detail">{i.detail}</span></span>
          <span className="muted act-time" title={new Date(i.time).toUTCString()}>{ago(i.time)}</span>
          <span className="act-tx">{i.hash ? <TxLink hash={i.hash} net={NET} chars={8} /> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Activity() {
  const w = useWallet();
  const [scope, setScope] = useState<"mine" | "network">("mine");
  const [filter, setFilter] = useState<"all" | ActivityKind>("all");
  const addr = scope === "mine" ? w.address : null;
  const feed = useAsync(() => (scope === "mine" && !w.address ? Promise.resolve([] as ActivityItem[]) : fetchActivity(NET, addr, 100)), [scope, w.address]);
  const rows = useMemo(() => filterItems(feed.data ?? [], filter), [feed.data, filter]);
  return (
    <>
      <PageHead kicker="Activity" title="Activity" right={<span className="pill gold">{IS_MAINNET ? "Mainnet · real funds" : "Testnet · no real value"}</span>}>
        Your swaps, exchange orders, pool deposits and withdrawals, and GLACIERQ reward and referral payments in one timeline, plus a view of the whole network. Every transaction opens on StellarChain.
      </PageHead>
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={scope === "mine"} className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")} data-testid="act-mine">Mine</button>
            <button role="tab" aria-selected={scope === "network"} className={scope === "network" ? "on" : ""} onClick={() => setScope("network")} data-testid="act-network">Network</button>
          </div>
          <button className="btn small ghost" onClick={() => feed.reload()}>Refresh</button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "12px 0" }} role="group" aria-label="Filter activity">
          {ACTIVITY_FILTERS.map((f) => <button key={f.v} className={`chip ${filter === f.v ? "on" : ""}`} onClick={() => setFilter(f.v)} data-testid={`act-filter-${f.v}`}>{f.label}</button>)}
        </div>
        {scope === "mine" && !w.address
          ? <p className="muted" data-testid="act-signedout">Create a keypair or sign in with your secret key to see your own activity. <button className="btn small" onClick={() => w.openModal()}>Sign in</button> The Network tab works without one.</p>
          : <ActivityList items={rows} loading={feed.loading} error={feed.error} empty={filter === "all" ? (scope === "mine" ? "Nothing yet. Make a swap or a deposit and it shows up here." : "No recent activity found.") : "Nothing of this kind in the latest 100 operations."} />}
        <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 0 }}>Shows the latest 100 operations from Horizon. {scope === "network" ? "The network view lists the most recent operations from anyone." : <>Rewards and referral bonuses appear here once paid; see <Link to="/earn">Earnings</Link>.</>}</p>
      </div>
    </>
  );
}
