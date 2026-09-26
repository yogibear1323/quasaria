import { useEffect } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import Layout from "./components/Layout";
import Trade from "./pages/Trade";
import Pools from "./pages/Pools";
import Stake from "./pages/Stake";
import Rewards from "./pages/Rewards";
import Referrals, { REF_KEY } from "./pages/Referrals";
import Bots from "./pages/Bots";
import Markets from "./pages/Markets";

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
    <>
      <RefCapture />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/trade" replace />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/pools" element={<Pools />} />
          <Route path="/stake" element={<Stake />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/referrals" element={<Referrals />} />
          <Route path="/bots" element={<Bots />} />
          <Route path="*" element={<Navigate to="/trade" replace />} />
        </Route>
      </Routes>
    </>
  );
}
