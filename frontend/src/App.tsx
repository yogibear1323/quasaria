import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import Layout from "./components/Layout";
import Trade from "./pages/Trade";
import Pools from "./pages/Pools";
import Stake from "./pages/Stake";
import Rewards from "./pages/Rewards";
import Referrals, { REF_KEY } from "./pages/Referrals";
import Bots from "./pages/Bots";
import Markets from "./pages/Markets";
import Landing from "./pages/Landing";
import Earn from "./pages/Earn";
import Calculators from "./pages/Calculators";
import Quests from "./pages/Quests";
import Merch from "./pages/Merch";
import News from "./pages/News";
import Lending from "./pages/Lending";
import Perps from "./pages/Perps";
import BackOffice from "./pages/BackOffice";
import { GameProvider } from "./game/GameProvider";

/** Live XLM chart pulls in lightweight-charts: lazy so it never weighs on other routes. */
const XlmChart = lazy(() => import("./pages/XlmChart"));

/** Captures ?ref=G... from shareable links for the Referrals page. */
function RefCapture() {
  const [params] = useSearchParams();
  useEffect(() => {
    const ref = params.get("ref");
    if (ref && /^G[A-Z2-7]{55}$/.test(ref) && !localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, ref);
  }, [params]);
  return null;
}

export default function App() {
  return (
    <GameProvider>
      <RefCapture />
      <Routes>
        {/* Public landing page; the app keeps its top-level routes (/trade, /pools, …). /app is an alias for Trade. */}
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Navigate to="/trade" replace />} />
        <Route element={<Layout />}>
          <Route path="/markets" element={<Markets />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/pools" element={<Pools />} />
          <Route path="/lending" element={<Lending />} />
          <Route path="/earn" element={<Earn />} />
          <Route path="/calculators" element={<Calculators />} />
          <Route path="/stake" element={<Stake />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/referrals" element={<Referrals />} />
          <Route path="/perps" element={<Perps />} />
          <Route path="/perps/chart" element={<Suspense fallback={<p className="muted">Loading chart…</p>}><XlmChart /></Suspense>} />
          <Route path="/back-office" element={<BackOffice />} />
          <Route path="/bots" element={<Bots />} />
          <Route path="/quests" element={<Quests />} />
          <Route path="/merch" element={<Merch />} />
          <Route path="/news" element={<News />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </GameProvider>
  );
}
