import { PageHead } from "../components/ui";
import LpCalculator from "../components/calc/LpCalculator";
import { IS_MAINNET } from "../lib/config";
import { useXlmUsd } from "../lib/markets";

/** /calculators: one native-pool fee estimate from Horizon reserves and a finished 24h trade window. */
export default function Calculators() {
  const xlm = useXlmUsd();
  const pricing = { xlmUsd: IS_MAINNET ? (xlm?.price ?? null) : null };
  return (
    <>
      <PageHead kicker="Earn" title="Calculators" right={<span className="pill gold">Estimates</span>}>
        Estimate pool-fee income for a deposit into one live native pool. The rate uses that pool's reserves and a completed 24 hour list of its trades. An incomplete or missing window has no annualized rate.
      </PageHead>
      <div className="calc-stack" data-testid="calc-page">
        <section id="lp"><LpCalculator pricing={pricing} /></section>
      </div>
    </>
  );
}
