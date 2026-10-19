
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Trade from "./pages/Trade";
import Pools from "./pages/Pools";
import Markets from "./pages/Markets";
import Landing from "./pages/Landing";
import Earn from "./pages/Earn";
import Holders from "./pages/Holders";
import Calculators from "./pages/Calculators";
import Quests from "./pages/Quests";
import Merch from "./pages/Merch";
import News from "./pages/News";
import About from "./pages/About";
import { GameProvider } from "./game/GameProvider";

export default function App() {
  return (
    <GameProvider>
      <Routes>
        {/* Public landing page; the app keeps its top-level routes (/trade, /pools, …). /app is an alias for Trade. */}
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Navigate to="/trade" replace />} />
        <Route element={<Layout />}>
          <Route path="/markets" element={<Markets />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/pools" element={<Pools />} />
          <Route path="/earn" element={<Earn />} />
          <Route path="/holders" element={<Holders />} />
          <Route path="/calculators" element={<Calculators />} />
          <Route path="/quests" element={<Quests />} />
          <Route path="/merch" element={<Merch />} />
          <Route path="/news" element={<News />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </GameProvider>
  );
}
