import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import AccountModal from "./AccountModal";
import logo from "../assets/logo-light.svg";
import { MERCH_MARK } from "../merch/catalog";
import { Orbits } from "./Quasar";
import WorldBackground, { type Scene } from "../world/WorldBackground";
import WorldNav from "../world/WorldNav";
import { useWallet } from "../lib/wallet";
import { short } from "../lib/format";
import { OFFLINE_DEMO } from "../lib/config";
import { hms, useLiveXlmUsd } from "../lib/liveMarkets";
import { useXlmUsd } from "../lib/markets";
import { asOf, snapshotLabel } from "../lib/stellarchain";
import { LevelBadge } from "../game/widgets";

function XlmTicker() {
  const x = useXlmUsd();
  // Live XLM/USD from Stellar mainnet Horizon (XLM/USDC), shared with the Markets page feed; old source is the fallback.
  const live = useLiveXlmUsd(5 * 60_000, OFFLINE_DEMO);
  if (live?.price) {
    return (
      <span className="pill" title={`XLM/USD live from Stellar mainnet Horizon (XLM/USDC, Circle issuer) · updated ${hms(live.at)}`} data-testid="xlm-ticker">
        XLM <b className="mono" style={{ color: "var(--star, #fff)" }}>${live.price.toFixed(4)}</b>
        <span className="muted" style={{ fontSize: "0.62rem" }}>live</span>
      </span>
    );
  }
  if (!x?.price) return null;
  const snap = x.source === "stellarchain" && x.feed === "snapshot";
  const src = x.source === "stellarchain" ? `stellarchain.io${snap ? ` (${snapshotLabel(x.snapshotAt)})` : ""}` : "Horizon testnet";
  return (
    <span className="pill" title={`XLM/USD ${x.note ?? ""} · source: ${src}${x.updatedAt ? ` · as of ${x.updatedAt}` : ""}`} data-testid="xlm-ticker">
      XLM <b className="mono" style={{ color: "var(--star, #fff)" }}>${x.price.toFixed(4)}</b>
      <span className="muted" style={{ fontSize: "0.62rem" }}>{snap ? snapshotLabel(x.snapshotAt) : x.updatedAt ? asOf(x.updatedAt).replace(" ago", "") : ""}{x.stale ? " · stale" : ""}</span>
    </span>
  );
}

const NAV: { to: string; label: string; scene: Scene }[] = [
  { to: "/markets", label: "Markets", scene: "constellation" },
  { to: "/trade", label: "Trade", scene: "quasar" },
  { to: "/pools", label: "Pools", scene: "nebula" },
  { to: "/earn", label: "Earnings", scene: "supernova" },
  { to: "/holders", label: "Holders", scene: "supernova" },
  { to: "/quests", label: "Quests", scene: "constellation" },
  { to: "/merch", label: "Merch", scene: "nebula" },
  { to: "/news", label: "News", scene: "constellation" },
];

const QUICK = new Set(["/markets", "/trade", "/pools", "/earn", "/holders"]);

export function sceneFor(path: string): Scene {
  if (path.startsWith("/calculators")) return "orbits";
  return NAV.find((n) => path.startsWith(n.to))?.scene ?? "quasar";
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
            <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(w.address!).catch(() => void 0)}>Copy address</button>
            <button className="btn small ghost" onClick={() => { setMenu(false); w.openModal("fund"); }}>Receive / fund (QR)</button>
            <a className="btn small ghost" href={`https://stellar.expert/explorer/testnet/account/${w.address}`} target="_blank" rel="noreferrer">View on stellar.expert ↗</a>
            <button className="btn small ghost" onClick={() => { setMenu(false); w.disconnect(); }}>Sign out of this tab</button>
            <button className="btn small ghost neg" onClick={() => { if (window.confirm("Forget this key? It is removed from this tab and any encrypted copy is deleted from this browser. Make sure your secret key is saved: Quasaria cannot recover it.")) { setMenu(false); w.forgetKey(); } }}>Forget this key</button>
          </div>
        )}
      </div>
    );
  return (
    <button className="btn small" onClick={() => w.openModal()} data-testid="account-cta">
      {w.stored ? "Unlock key" : "Create / sign in"}
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
          {/* Quick strip: the busiest districts one click away; the full map lives in WorldNav. */}
          <nav className="nav quick-nav" aria-label="Quick links">
            {NAV.filter((n) => QUICK.has(n.to)).map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive || (n.to === "/earn" && loc.pathname.startsWith("/calculators")) ? "active" : "")}>
                  {n.label}
                </NavLink>
            ))}
          </nav>
          <XlmTicker />
          <span className="net-badge">Testnet</span>
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
              Quasaria is an <b>unaudited, testnet-only</b> scaffold. Nothing here is financial advice. Liquidity pools and token rewards
              carry substantial risk of loss and may be regulated in your jurisdiction.
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}
