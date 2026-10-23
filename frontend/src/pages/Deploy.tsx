import { PageHead } from "../components/ui";
import { RwaDeployInfo } from "../components/RwaDeployInfo";

export default function Deploy() {
  return (
    <>
      <PageHead kicker="Deploy info" title="Latest deploy" right={<span className="pill pink">TESTNET</span>}>
        The newest testnet deployment of the RWA yield layer. Links open StellarChain.io (testnet).
      </PageHead>
      <RwaDeployInfo />
    </>
  );
}
