import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import AccountModal from "./AccountModal";
import logo from "../assets/logo.svg";
import CosmicBackground, { type Scene } from "./CosmicBackground";
import { useWallet } from "../lib/wallet";
import { short } from "../lib/format";
import { CONTRACTS_CONFIGURED, OFFLINE_DEMO } from "../lib/config";
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
  { to: "/perps", label: "Perps", scene: "warp" },
  { to: "/pools", label: "Pools", scene: "nebula" },
  { to: "/lending", label: "Lend", scene: "orbits" },
  { to: "/earn", label: "Earn", scene: "supernova" },
  { to: "/stake", label: "Stake", scene: "orbits" },
  { to: "/rewards", label: "QFX Mint & Rewards", scene: "supernova" },
  { to: "/referrals", label: "Referrals", scene: "constellation" },
  { to: "/bots", label: "Bots & Leverage", scene: "warp" },
  { to: "/quests", label: "Quests", scene: "constellation" },
  { to: "/merch", label: "Merch", scene: "nebula" },
  { to: "/news", label: "News", scene: "constellation" },
];

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
        {w.wrongNetwork && <span className="pill pink">Switch Freighter to TESTNET</span>}
        <button className="btn ghost small mono" onClick={() => setMenu((m) => !m)} title="Account" aria-haspopup="menu">
          ● {short(w.address, 5)} <span className="muted" style={{ fontSize: "0.65rem" }}>{w.kind === "local" ? "in-app key" : "Freighter"}</span>
        </button>
        {menu && (
          <div className="card acct-menu" role="menu" onMouseLeave={() => setMenu(false)}>
            <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(w.address!).catch(() => void 0)}>Copy address</button>
            <a className="btn small ghost" href={`https://stellar.expert/explorer/testnet/account/${w.address}`} target="_blank" rel="noreferrer">View on stellar.expert ↗</a>
            <button className="btn small ghost" onClick={() => { setMenu(false); w.disconnect(); }}>{w.kind === "local" ? "Lock / sign out" : "Disconnect"}</button>
            {w.stored && (
              <button className="btn small ghost neg" onClick={() => { if (window.confirm("Remove the encrypted key from this device? Make sure your secret key is backed up.")) { setMenu(false); w.forgetDevice(); } }}>Forget this device</button>
            )}
          </div>
        )}
      </div>
    );
  return (
    <button className="btn small" onClick={w.openModal} disabled={w.connecting}>
      {w.stored ? "Unlock account" : "Create account"}
    </button>
  );
}

export default function Layout() {
  const loc = useLocation();
  const w = useWallet();
  const scene = sceneFor(loc.pathname);
  return (
    <>
      <CosmicBackground scene={scene} />
      <div className="app">
        {(!w.address || !CONTRACTS_CONFIGURED) && (
          <div className="demo-banner">
            {!w.address ? (CONTRACTS_CONFIGURED ? "Read-only mode — live Soroban TESTNET contracts, viewed through public seeded demo accounts. Create an in-app account or connect Freighter (TESTNET) to trade. " : "Read-only demo mode — create an account or connect Freighter (TESTNET) to trade. ") : ""}
            {!CONTRACTS_CONFIGURED ? "Soroban contracts not configured: showing demo data (run scripts/deploy-testnet.sh)." : ""}
          </div>
        )}
        <header className="topbar">
          <NavLink to="/" className="brand" aria-label="Quasaria home">
            <img src={logo} alt="" />
            <span className="word">Quasaria</span>
          </NavLink>
          <nav className="nav">
            {NAV.map((n) => (
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
        {w.error && !w.modalOpen && <div className="demo-banner">{w.error}</div>}
        {w.modalOpen && <AccountModal />}
        <main>
          <Outlet />
        </main>
        <footer>
          <div className="foot-inner">
            <span className="foot-brand"><img src={logo} alt="" />Quasaria</span>
            <span>
              Quasaria is an <b>unaudited, testnet-only</b> scaffold. Nothing here is financial advice. Leverage and yield features
              carry substantial risk of loss and may be regulated in your jurisdiction.
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}
