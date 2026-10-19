import { PageHead } from "../components/ui";
import { useSearchParams } from "react-router-dom";
import LpCalculator from "../components/calc/LpCalculator";

/** /calculators: the liquidity-pool fee and impermanent-loss calculator (?pool= preselects a pool). */
export default function Calculators() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHead kicker="Earn" title="Calculators" right={<span className="pill gold">Estimates</span>}>
        Estimate what providing liquidity could earn, and what impermanent loss could cost, from recent pool volume and fee rates.
      </PageHead>
      <div className="calc-stack" data-testid="calc-page">
        <section id="lp"><LpCalculator initialPool={params.get("pool") ?? undefined} /></section>
      </div>
    </>
  );
}
