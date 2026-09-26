import { NavLink, Outlet, useLocation } from "react-router-dom";
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
    <span className="pill" title={`${x.note ?? ""} · ${src}${x.updatedAt ? ` · ${x.updatedAt}` : ""}`}>
      XLM <b className="mono" style={{ color: "var(--star, #fff)" }}>${x.price.toFixed(4)}</b>
      <span className="muted" style={{ fontSize: "0.65rem" }}>{x.updatedAt ? asOf(x.updatedAt) : ""}{x.stale ? " · stale" : ""} · {src}</span>
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
  if (w.address)
    return (
      <div className="row">
        {w.wrongNetwork && <span className="pill pink">Switch Freighter to TESTNET</span>}
        <button className="btn ghost small mono" onClick={w.disconnect} title="Disconnect">
          ● {short(w.address, 5)}
        </button>
      </div>
    );
  return (
    <button className="btn small" onClick={w.connect} disabled={w.connecting}>
      {w.connecting ? "Connecting…" : "Connect Freighter"}
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
            {!w.address ? (CONTRACTS_CONFIGURED ? "Read-only mode — live Soroban TESTNET contracts, viewed through public seeded demo accounts. Connect Freighter (TESTNET) to trade. " : "Read-only demo mode — connect Freighter (TESTNET) to trade. ") : ""}
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
        {w.error && <div className="demo-banner">{w.error}</div>}
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
