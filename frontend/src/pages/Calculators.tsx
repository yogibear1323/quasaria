import { PageHead } from "../components/ui";
import LpCalculator from "../components/calc/LpCalculator";

/** /calculators: the liquidity-pool fee and impermanent-loss calculator (manual inputs, nothing read from the chain). */
export default function Calculators() {
  return (
    <>
      <PageHead kicker="Earn" title="Calculators" right={<span className="pill gold">Estimates</span>}>
        Estimate what providing liquidity could earn, and what impermanent loss could cost, from the pool reserves and daily volume you enter.
      </PageHead>
      <div className="calc-stack" data-testid="calc-page">
        <section id="lp"><LpCalculator /></section>
      </div>
    </>
  );
}
