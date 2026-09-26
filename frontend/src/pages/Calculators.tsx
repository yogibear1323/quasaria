import { useSearchParams } from "react-router-dom";
import { PageHead, Tabs } from "../components/ui";
import StakingCalculator from "../components/calc/StakingCalculator";
import HolderYieldCalculator from "../components/calc/HolderYieldCalculator";
import LpCalculator from "../components/calc/LpCalculator";

type Which = "all" | "staking" | "holder" | "lp";
const OPTIONS: { v: Which; label: string }[] = [
  { v: "all", label: "All" },
  { v: "staking", label: "Staking" },
  { v: "holder", label: "Holder yield" },
  { v: "lp", label: "Liquidity" },
];

/** /calculators — all three Earn calculators; ?c=staking|holder|lp focuses one, ?pool= preselects a pool. */
export default function Calculators() {
  const [params, setParams] = useSearchParams();
  const c = (OPTIONS.some((o) => o.v === params.get("c")) ? params.get("c") : "all") as Which;
  const pool = params.get("pool") ?? undefined;
  const set = (v: Which) => setParams(v === "all" ? {} : { c: v }, { replace: true });
  const show = (w: Which) => c === "all" || c === w;
  return (
    <>
      <PageHead kicker="Scene · Orbital Rings · Earn" title="Calculators" right={<span className="pill gold">Estimates · live testnet rates</span>}>
        Estimate what staking, holding QFX and providing liquidity could earn, using rates, locks, reserves, fee rates and recent volume read live from the Quasaria testnet contracts.
      </PageHead>
      <div className="calc-tabs">
        <Tabs value={c} onChange={set} options={OPTIONS} />
      </div>
      <div className="calc-stack" data-testid="calc-page">
        {show("staking") && <section id="staking"><StakingCalculator initialPool={c === "staking" && pool !== undefined && /^\d+$/.test(pool) ? Number(pool) : undefined} /></section>}
        {show("holder") && <section id="holder"><HolderYieldCalculator /></section>}
        {show("lp") && <section id="lp"><LpCalculator initialPool={c === "lp" ? pool : undefined} /></section>}
      </div>
    </>
  );
}
