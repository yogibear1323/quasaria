
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import Trade from "./pages/Trade";
import Pools from "./pages/Pools";
import Vault from "./pages/Vault";
import Markets from "./pages/Markets";
import Landing from "./pages/Landing";
import Earn from "./pages/Earn";
import Holders from "./pages/Holders";
import Calculators from "./pages/Calculators";
import Quests from "./pages/Quests";
import Merch from "./pages/Merch";
import News from "./pages/News";
import Wallet from "./pages/Wallet";
import Account from "./pages/Account";
// Referral program hidden for now (2026-10-24); page kept in src/pages/Referral.tsx for restore.
import Activity from "./pages/Activity";
import About from "./pages/About";
import Buy from "./pages/Buy";
import Swap from "./pages/Swap";
import Deploy from "./pages/Deploy";
import { REDIRECTS } from "./lib/nav";
import { GameProvider } from "./game/GameProvider";

/** Old URLs keep working: /trade?base=… lands on /exchange?base=… */
function Redirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

export default function App() {
  return (
    <GameProvider>
      <Routes>
        {/* Public landing page; the app keeps its top-level routes (/trade, /pools, …). /app is an alias for Trade. */}
        <Route path="/" element={<Landing />} />
        {Object.entries(REDIRECTS).map(([from, to]) => <Route key={from} path={from} element={<Redirect to={to} />} />)}
        <Route element={<Layout />}>
          <Route path="/markets" element={<Markets />} />
          <Route path="/exchange" element={<Trade mode="exchange" />} />
          <Route path="/swap" element={<Swap />} />
          <Route path="/referral" element={<Navigate to="/" replace />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/buy" element={<Buy />} />
          <Route path="/about" element={<About />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/account" element={<Account />} />
          <Route path="/pools" element={<Pools />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/earn" element={<Earn />} />
          <Route path="/holders" element={<Holders />} />
          <Route path="/calculators" element={<Calculators />} />
          <Route path="/quests" element={<Quests />} />
          <Route path="/merch" element={<Merch />} />
          <Route path="/news" element={<News />} />
          <Route path="/deploy" element={<Deploy />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </GameProvider>
  );
}
