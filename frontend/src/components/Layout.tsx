import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import AccountModal from "./AccountModal";
import logo from "../assets/logo.svg";
import CosmicBackground, { type Scene } from "./CosmicBackground";
import { useWallet } from "../lib/wallet";
import { short } from "../lib/format";
import { CONTRACTS_CONFIGURED } from "../lib/config";
import { useXlmUsd } from "../lib/markets";
import { asOf } from "../lib/stellarchain";

function XlmTicker() {
  const x = useXlmUsd();
  if (!x?.price) return null;
  const src = x.source === "stellarchain" ? "stellarchain.io" : "Horizon testnet";
  return (
    <span className="pill" title={`XLM/USD ${x.note ?? ""} · source: ${src}${x.updatedAt ? ` · as of ${x.updatedAt}` : ""}`}>
      XLM <b className="mono" style={{ color: "var(--star, #fff)" }}>${x.price.toFixed(4)}</b>
      <span className="muted" style={{ fontSize: "0.62rem" }}>{x.updatedAt ? asOf(x.updatedAt).replace(" ago", "") : ""}{x.stale ? " · stale" : ""}</span>
    </span>
  );
}

const NAV: { to: string; label: string; scene: Scene }[] = [
  { to: "/markets", label: "Markets", scene: "constellation" },
  { to: "/trade", label: "Trade", scene: "quasar" },
  { to: "/pools", label: "Pools", scene: "nebula" },
  { to: "/stake", label: "Stake", scene: "orbits" },
  { to: "/rewards", label: "QFX Rewards", scene: "supernova" },
  { to: "/referrals", label: "Referrals", scene: "constellation" },
  { to: "/bots", label: "Bots & Leverage", scene: "warp" },
];

export function sceneFor(path: string): Scene {
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
          <NavLink to="/trade" className="brand" aria-label="Quasaria home">
            <img src={logo} alt="" />
            <span className="word grad-text">QUASARIA</span>
          </NavLink>
          <nav className="nav">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <XlmTicker />
          <span className="net-badge">Testnet</span>
          <WalletButton />
        </header>
        {w.error && !w.modalOpen && <div className="demo-banner">{w.error}</div>}
        {w.modalOpen && <AccountModal />}
        <main>
          <Outlet />
        </main>
        <footer>
          Quasaria is an <b>unaudited, testnet-only</b> scaffold. Nothing here is financial advice. Leverage and yield features
          carry substantial risk of loss and may be regulated in your jurisdiction.
        </footer>
      </div>
    </>
  );
}
