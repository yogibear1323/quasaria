import { PageHead } from "../components/ui";
import { RwaDeployInfo } from "../components/RwaDeployInfo";

export default function Deploy() {
  return (
    <>
      <PageHead kicker="Deploy info" title="Latest deploy" right={<span className="pill green">MAINNET</span>}>
        The RWA yield layer on Stellar mainnet. Links open StellarChain.io.
      </PageHead>
      <RwaDeployInfo />
    </>
  );
}
