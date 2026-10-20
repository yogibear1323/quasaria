import { NETWORK, NETWORK_LABEL, IS_MAINNET } from "../lib/config";
import { explorerAccountUrl } from "../lib/explorer";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import AccountModal from "./AccountModal";
import { CopyButton } from "./CopyButton";
import logo from "../assets/logo-light.svg";
import { MERCH_MARK } from "../merch/catalog";
import { Orbits } from "./Quasar";
import { NAV_GROUP, NAV_KEY, NAV_MORE, NAV_REST, NAV_SWAP, isActive, sceneFor } from "../lib/nav";
import WorldBackground from "../world/WorldBackground";
import WorldNav from "../world/WorldNav";
import { useWallet } from "../lib/wallet";
import { short } from "../lib/format";
import { OFFLINE_DEMO } from "../lib/config";
import { hms, useLiveXlmUsd } from "../lib/liveMarkets";
import { useXlmUsd } from "../lib/markets";
import { asOf, snapshotLabel } from "../lib/stellarchain";
import { LevelBadge } from "../game/widgets";
import XlmMark from "./XlmMark";

function XlmTicker() {
  const x = useXlmUsd();
  // Live XLM/USD from Stellar mainnet Horizon (XLM/USDC), shared with the Markets page feed; old source is the fallback.
  const live = useLiveXlmUsd(5 * 60_000, OFFLINE_DEMO);
  if (live?.price) {
    return (
      <span className="pill" title={`XLM/USD live from Stellar mainnet Horizon (XLM/USDC, Circle issuer) · updated ${hms(live.at)}`} data-testid="xlm-ticker">
        <XlmMark size={15} />XLM <b className="mono" style={{ color: "var(--star, #fff)" }}>${live.price.toFixed(4)}</b>
        <span className="muted" style={{ fontSize: "0.62rem" }}>live</span>
      </span>
    );
  }
  if (!x?.price) return null;
  const snap = x.source === "stellarchain" && x.feed === "snapshot";
  const src = x.source === "stellarchain" ? `stellarchain.io${snap ? ` (${snapshotLabel(x.snapshotAt)})` : ""}` : `Horizon ${NETWORK_LABEL.toLowerCase()}`;
  return (
    <span className="pill" title={`XLM/USD ${x.note ?? ""} · source: ${src}${x.updatedAt ? ` · as of ${x.updatedAt}` : ""}`} data-testid="xlm-ticker">
      <XlmMark size={15} />XLM <b className="mono" style={{ color: "var(--star, #fff)" }}>${x.price.toFixed(4)}</b>
      <span className="muted" style={{ fontSize: "0.62rem" }}>{snap ? snapshotLabel(x.snapshotAt) : x.updatedAt ? asOf(x.updatedAt).replace(" ago", "") : ""}{x.stale ? " · stale" : ""}</span>
    </span>
  );
}

export { sceneFor };

/** Top row: [Markets | Exchange | Pools] segmented group, then Swap as its own tab, then the individual items. */
export function MainNav({ path }: { path: string }) {
  const cls = (to: string) => (isActive(path, to) || (to === "/earn" && path.startsWith("/calculators")) ? "active" : "");
  return (
    <nav className="nav quick-nav main-nav" aria-label="Main" data-testid="main-nav">
      <div className="nav-seg" role="group" aria-label="Markets, Exchange and Pools" data-testid="nav-group">
        {NAV_GROUP.map((n) => <NavLink key={n.to} to={n.to} className={cls(n.to)}>{n.label}</NavLink>)}
      </div>
      <NavLink to={NAV_SWAP.to} className="nav-swap" data-testid="nav-swap">{NAV_SWAP.label}</NavLink>
      <span className="nav-sep" aria-hidden />
      {NAV_REST.map((n) => <NavLink key={n.to} to={n.to} className={cls(n.to)}>{n.label}</NavLink>)}
    </nav>
  );
}

/** Phone / tablet menu: the same order, every item top-level. */
export function MobileMenu({ path, defaultOpen = false, signedIn = false }: { path: string; defaultOpen?: boolean; signedIn?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [top, setTop] = useState(64);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!defaultOpen) setOpen(false); }, [path, defaultOpen]);
  const toggle = () => { if (!open && btn.current) setTop(Math.round(btn.current.getBoundingClientRect().bottom + 8)); setOpen((o) => !o); };
  const cls = (to: string) => (isActive(path, to) ? "active" : "");
  const panel = (
    <>
      <div className="wn-scrim" onClick={() => setOpen(false)} />
      <nav id="mm-panel" className="mm-panel card" aria-label="Menu" style={{ top }}>
        <div className="nav-seg" role="group" aria-label="Markets, Exchange and Pools">
          {NAV_GROUP.map((n) => <NavLink key={n.to} to={n.to} className={cls(n.to)}>{n.label}</NavLink>)}
        </div>
        <NavLink to={NAV_SWAP.to} className="mm-item nav-swap">{NAV_SWAP.label}</NavLink>
        {NAV_REST.map((n) => <NavLink key={n.to} to={n.to} className={`mm-item ${cls(n.to)}`}>{n.label}</NavLink>)}
        <div className="mm-more muted">More</div>
        {NAV_MORE.map((n) => <NavLink key={n.to} to={n.to} className={`mm-item ${cls(n.to)}`}>{n.label}</NavLink>)}
        {signedIn && NAV_KEY.map((n) => <NavLink key={n.to} to={n.to} className={`mm-item ${cls(n.to)}`} data-testid="mm-key-link">{n.label}</NavLink>)}
      </nav>
    </>
  );
  return (
    <div className="mobile-menu" data-testid="mobile-menu">
      <button ref={btn} className="btn small ghost mm-btn" aria-expanded={open} aria-controls="mm-panel" onClick={toggle}>{open ? "✕ Close" : "☰ Menu"}</button>
      {open && (typeof document === "undefined" ? panel : createPortal(panel, document.body))}
    </div>
  );
}

function WalletButton() {
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  if (w.address)
    return (
      <div className="row" style={{ position: "relative" }}>
        <button className="btn ghost small mono" onClick={() => setMenu((m) => !m)} title="Account" aria-haspopup="menu" data-testid="account-button">
          ● {short(w.address, 5)} <span className="muted" style={{ fontSize: "0.65rem" }}>your key</span>
        </button>
        {menu && (
          <div className="card acct-menu" role="menu" onMouseLeave={() => setMenu(false)}>
            {NAV_KEY.map((n) => <Link key={n.to} className="btn small ghost" to={n.to} role="menuitem" onClick={() => setMenu(false)} data-testid="acct-menu-link">{n.label}</Link>)}
            <CopyButton value={w.address} label="Copy address" />
            <button className="btn small ghost" onClick={() => { setMenu(false); w.openModal("fund"); }}>Receive / fund (QR)</button>
            <a className="btn small ghost" href={explorerAccountUrl(w.address, NETWORK) ?? undefined} target="_blank" rel="noopener noreferrer">View on StellarChain ↗</a>
            <button className="btn small ghost" onClick={() => { setMenu(false); w.disconnect(); }}>Sign out of this tab</button>
            <button className="btn small ghost neg" onClick={() => { if (window.confirm("Forget this key? It is removed from this tab and any encrypted copy is deleted from this browser. Make sure your secret key is saved: Quasaria cannot recover it.")) { setMenu(false); w.forgetKey(); } }}>Forget this key</button>
          </div>
        )}
      </div>
    );
  return (
    <button className="btn small" onClick={() => w.openModal()} data-testid="account-cta">
      Create / sign in
    </button>
  );
}

export default function Layout() {
  const loc = useLocation();
  const w = useWallet();
  const scene = sceneFor(loc.pathname);
  // The merch store carries the yeti mark (same image as the GLACIERQ token icon) instead of the Q.
  const isMerch = loc.pathname === "/merch" || loc.pathname.startsWith("/merch/");
  const mark = isMerch ? MERCH_MARK : logo;
  return (
    <>
      <WorldBackground scene={scene} />
      <div className="app">
        {!w.address && (
          <div className="demo-banner" data-testid="readonly-banner">
            Read-only mode. Create a keypair here, or sign in by pasting your secret key, to trade. Your key stays in your browser. Quasaria never holds your keys or your XLM.
          </div>
        )}
        {w.address && w.funded === false && (
          <div className="demo-banner" data-testid="fund-banner">
            Your account is not on the ledger yet. Send it a little XLM to open it. <button className="btn small ghost" onClick={() => w.openModal("fund")}>Show address &amp; QR</button>
          </div>
        )}
        <header className="topbar">
          <NavLink to="/" className="brand" aria-label="Quasaria home">
            <img src={mark} alt="" className={isMerch ? "is-yeti" : undefined} />
            <span className="word">Quasaria</span>
          </NavLink>
          <WorldNav />
          <MainNav path={loc.pathname} />
          <MobileMenu path={loc.pathname} signedIn={!!w.address} />
          <XlmTicker />
          <span className="net-badge">{NETWORK_LABEL}</span>
          <LevelBadge />
          <WalletButton />
        </header>
                {w.modalOpen && <AccountModal />}
        <main className="pg-main">
          {loc.pathname !== "/" && <Orbits className="pg-orbits" />}
          <Outlet />
        </main>
        <footer>
          <div className="foot-inner">
            <span className="foot-brand"><img src={mark} alt="" className={isMerch ? "is-yeti" : undefined} />Quasaria</span>
            <span>
              {IS_MAINNET ? <>Quasaria runs on Stellar <b>mainnet</b>: transactions are real and you sign each one with your own key. Not yet audited.</> : <>Quasaria is a <b>testnet-only</b> scaffold.</>} Nothing here is financial advice. Liquidity pools and token rewards
              carry substantial risk of loss and may be regulated in your jurisdiction.
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}
