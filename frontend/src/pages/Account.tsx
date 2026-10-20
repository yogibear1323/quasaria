import { curatedList } from "../lib/nativePools";
import { NETWORK, NETWORK_LABEL } from "../lib/config";
import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import QrCode from "../components/QrCode";
import XlmMark from "../components/XlmMark";
import { AssetLogo } from "../components/AssetBits";
import { CopyButton } from "../components/CopyButton";
import { useWallet } from "../lib/wallet";
import { useAccount } from "../lib/useAccount";
import { useAsync } from "../lib/useAsync";
import { fetchPool, poolPosition, rewardStatus, type AccountView, type PoolPosition } from "../lib/account";
import { REWARD_ASSET_CODE, REWARD_ISSUER, REWARD_TIERS, pctYear } from "../lib/rewards";
import { explorerAccountUrl, explorerAssetUrl } from "../lib/explorer";
import { fmt, fmtCompact, short } from "../lib/format";

const NET = NETWORK;
const NET_LABEL = NETWORK_LABEL;
const DASH = "—";
/** Icons from the curated list (issuers' stellar.toml) by code + issuer; GLACIERQ uses our token icon inside AssetLogo. */
const LOGOS = new Map(curatedList(NET).filter((a) => a.issuer && a.logo).map((a) => [`${a.code}:${a.issuer}`, a.logo as string]));
const trim7 = (n: number) => fmt(n, 7).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

export default function Account() {
  const w = useWallet();
  const acct = useAccount(NET, w.address);
  if (!w.address) {
    return (
      <>
        <PageHead kicker="Account" title="Your account">Your public address and everything you hold, read straight from the Stellar network.</PageHead>
        <div className="card glow" data-testid="account-signedout">
          <h2 style={{ marginTop: 0 }}>No key active</h2>
          <p className="muted">Create a keypair or sign in with your secret key to see your account. Quasaria never holds your secret key.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => w.openModal("create")}>Create a keypair</button>
            <button className="btn ghost" onClick={() => w.openModal()}>Sign in with secret key</button>
          </div>
        </div>
      </>
    );
  }
  const address = w.address;
  const view = acct.view;
  const unfunded = view?.exists === false;
  return (
    <>
      <PageHead kicker="Account" title="Your account" right={<span className="pill gold" data-testid="net-label">{NET_LABEL === "Testnet" ? "Testnet · no real value" : NET_LABEL}</span>}>
        Read-only view from the Stellar network. Your secret key never leaves this browser and is never shown here.
      </PageHead>

      <section className="card glow acct-head" data-testid="account-address">
        <div className="acct-head-main">
          <div className="kicker" style={{ marginBottom: 4 }}>Public address <span className="pill cyan" style={{ marginLeft: 6 }}>{NET_LABEL}</span></div>
          <div className="acct-short mono" data-testid="address-short" title={address}>{short(address, 6)}</div>
          <div className="acct-full-row"><div className="acct-full mono" data-testid="address-full" title="Your full public address">{address}</div><CopyButton value={address} label="Copy" ghost={false} /></div>
          <div className="acct-actions">
            <CopyButton value={address} label="Copy address" />
            <Link className="btn small ghost" to="/wallet" data-testid="acct-send">Send / receive</Link>
            <a className="btn small ghost" href={explorerAccountUrl(address, NET) ?? undefined} target="_blank" rel="noopener noreferrer">StellarChain ↗</a>
            <button className="btn small ghost neg" data-testid="forget-key" onClick={() => { if (window.confirm("Forget this key? It is removed from this tab and any encrypted copy is deleted from this browser. Make sure your secret key is saved: Quasaria cannot recover it.")) w.forgetKey(); }}>Forget this key</button>
          </div>
        </div>
        <div className="acct-qr"><QrCode value={address} size={132} label="QR code of your public address" /></div>
      </section>

      {unfunded && (
        <div className="notice" style={{ marginTop: 16 }} data-testid="account-unfunded">
          <b>Not on the network yet.</b> This address appears on Stellar once it receives its first XLM (at least 1 XLM). <button className="btn small" onClick={() => w.openModal("fund")}>Fund it</button> <Link className="btn small ghost" to="/buy" data-testid="acct-buy">Buy XLM</Link>
        </div>
      )}
      {acct.error && <div className="notice" role="alert" style={{ marginTop: 16 }}>Could not reach Horizon ({acct.error}). Values show {DASH} until it answers. <button className="btn small ghost" onClick={acct.reload}>Retry</button></div>}

      <div className="grid g-2" style={{ marginTop: 16 }}>
        <Holdings view={view} loading={acct.loading && !view} updatedAt={acct.updatedAt} onRefresh={acct.reload} refreshing={acct.loading} />
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Rewards view={view} />
          <Positions view={view} />
        </div>
      </div>
    </>
  );
}

function Row({ icon, title, sub, value, subValue, testid }: { icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode; subValue?: React.ReactNode; testid?: string }) {
  return (
    <div className="hrow" data-testid={testid}>
      <span className="hrow-ico">{icon}</span>
      <div className="hrow-main"><b>{title}</b>{sub && <span className="muted l-tiny">{sub}</span>}</div>
      <div className="hrow-val"><b className="mono">{value}</b>{subValue && <span className="muted l-tiny">{subValue}</span>}</div>
    </div>
  );
}

export function Holdings({ view, loading, updatedAt = null, onRefresh, refreshing = false }: { view: AccountView | null; loading: boolean; updatedAt?: number | null; onRefresh?: () => void; refreshing?: boolean }) {
  const ex = view?.exists ? view : null;
  return (
    <section className="card" data-testid="holdings">
      <div className="row between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ marginTop: 0 }}>Holdings</h2>
        <span className="muted l-tiny" data-testid="holdings-updated">{updatedAt ? `Live from Horizon · updated ${new Date(updatedAt).toLocaleTimeString()}` : "Live from Horizon"} · refreshes every 10 s{onRefresh && <> <button className="btn small ghost" onClick={onRefresh} disabled={refreshing} data-testid="holdings-refresh">{refreshing ? "Refreshing…" : "Refresh"}</button></>}</span>
      </div>
      <Row testid="row-xlm" icon={<XlmMark size={28} />} title="XLM" sub="Stellar Lumens · native"
        value={ex ? trim7(ex.native.balance) : loading ? "…" : DASH}
        subValue={ex ? <>Available <span className="mono" data-testid="xlm-available">{ex.native.available === null ? DASH : trim7(ex.native.available)}</span> · Reserve <span className="mono" data-testid="xlm-reserve">{ex.native.reserve === null ? DASH : trim7(ex.native.reserve)}</span></> : `Available ${DASH} · Reserve ${DASH}`} />
      {ex?.native.sellingLiabilities ? <p className="muted l-tiny" style={{ margin: "4px 0 0" }}>{trim7(ex.native.sellingLiabilities)} XLM is committed to open offers.</p> : null}
      {ex?.holdings.map((h) => (
        <Row key={`${h.code}-${h.issuer}`} testid="row-trustline"
          icon={<AssetLogo code={h.code} issuer={h.issuer} size={28} logo={LOGOS.get(`${h.code}:${h.issuer}`) ?? null} />}
          title={<>{h.code}{h.verified && <span className="pill cyan" style={{ marginLeft: 8 }} title="Issuer matches the verified list">verified</span>}</>}
          sub={<>{h.verified ? <span>{h.verified} · </span> : "Unverified issuer "}<a className="mono" href={explorerAssetUrl(h.code, h.issuer, NET) ?? undefined} target="_blank" rel="noopener noreferrer" title={h.issuer}>{short(h.issuer, 4)} ↗</a></>}
          value={trim7(h.balance)} subValue={<>Available <span className="mono" data-testid="asset-available">{trim7(h.available)}</span>{h.sellingLiabilities ? ` · ${trim7(h.sellingLiabilities)} in open offers` : ""}{h.authorized ? "" : " · not authorized by issuer"}</>} />
      ))}
      {ex?.poolShares.map((p) => (
        <Row key={p.poolId} testid="row-poolshare" icon={<span className="mono" aria-hidden>≋</span>} title="Pool shares" sub={<>Liquidity pool {short(p.poolId, 4)} · <Link to="/pools">Pools</Link></>} value={trim7(p.shares)} subValue="see Liquidity positions" />
      ))}
      {ex && ex.holdings.length === 0 && ex.poolShares.length === 0 && <p className="muted l-tiny" style={{ margin: "10px 0 0" }}>No other assets yet. Add a trustline (for example USDC) from <Link to="/wallet">Send / receive</Link>.</p>}
      {!ex && !loading && <p className="muted l-tiny" style={{ margin: "10px 0 0" }}>Nothing to show until the account is on the network.</p>}
      <p className="muted l-tiny" style={{ margin: "12px 0 0" }}>Reserve is the XLM the network keeps locked for your account and its entries. XLM available = balance − reserve − open offers − 0.01 XLM kept for fees. Other assets: available = balance − open offers.</p>
    </section>
  );
}

export function Rewards({ view }: { view: AccountView | null }) {
  const ex = view?.exists ? view : null;
  const issuer = REWARD_ISSUER[NET];
  const bal = ex?.holdings.find((h) => h.isReward)?.balance ?? (ex ? 0 : null);
  const st = bal === null ? null : rewardStatus(bal);
  return (
    <section className="card" data-testid="reward-status">
      <h2 style={{ marginTop: 0 }}>{REWARD_ASSET_CODE} rewards</h2>
      <dl className="kv">
        <div><dt>Balance</dt><dd className="mono" data-testid="glacierq-balance">{bal === null ? DASH : `${fmt(bal, 2)} ${REWARD_ASSET_CODE}`}</dd></div>
        <div><dt>Tier</dt><dd data-testid="glacierq-tier">{st ? st.tier : DASH}</dd></div>
        <div><dt>Next tier</dt><dd>{st ? st.next ?? "Top tier" : DASH}</dd></div>
      </dl>
      <p className="muted l-tiny" style={{ margin: "8px 0 0" }}>
        {REWARD_TIERS.map((t) => `${pctYear(t.apr)}% a year from ${fmtCompact(t.min)}`).join(", ")}, paid daily on the whole balance. Not guaranteed. {!issuer && "The reward token is not on this network yet. "}<Link to="/holders">How holder rewards work</Link>
      </p>
    </section>
  );
}

export function Positions({ view }: { view: AccountView | null }) {
  const ex = view?.exists ? view : null;
  const ids = ex?.poolShares.map((p) => p.poolId).join(",") ?? "";
  const pos = useAsync<PoolPosition[]>(async () => (ex ? Promise.all(ex.poolShares.map(async (ps) => poolPosition(ps, await fetchPool(NET, ps.poolId), null, NET))) : []), [ids]);
  return (
    <section className="card" data-testid="lp-positions">
      <h2 style={{ marginTop: 0 }}>Liquidity positions</h2>
      {!ex ? <p className="muted l-tiny" style={{ margin: 0 }}>{DASH}</p>
        : ex.poolShares.length === 0 ? <p className="muted l-tiny" style={{ margin: 0 }}>No pool shares. Add liquidity from <Link to="/pools">Pools</Link>.</p>
        : (pos.data ?? ex.poolShares.map((p) => poolPosition(p, null, null, NET))).map((p) => (
          <div className="hrow hrow-stack" key={p.poolId} data-testid="lp-row">
            <div className="hrow-main"><b>{p.name}</b><span className="muted l-tiny">{p.feePct === null ? DASH : `${p.feePct}% fee`} · pool {short(p.poolId, 4)}</span></div>
            <div className="hrow-val"><b className="mono">{trim7(p.shares)} shares</b>
              <span className="muted l-tiny">{p.amounts.length ? p.amounts.map((a) => `${fmt(a.amount, 4)} ${a.code}`).join(" + ") : DASH}{p.shareOfPool !== null ? ` · ${(p.shareOfPool * 100).toFixed(p.shareOfPool < 0.0001 ? 6 : 3)}% of pool` : ""}</span>
              <span className="muted l-tiny">Est. value {p.valueUsd === null ? DASH : `$${fmt(p.valueUsd, 2)}`}</span></div>
          </div>
        ))}
    </section>
  );
}
