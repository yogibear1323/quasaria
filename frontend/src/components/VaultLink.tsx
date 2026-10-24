import { Link } from "react-router-dom";
import { IS_MAINNET } from "../lib/config";
import { VAULT_DEPOSIT_CAP_XLM } from "./YieldVaultCard";

/** Small pointer to the Yield Vault tab (used on Exchange and Pools). */
export function VaultLink() {
  if (!IS_MAINNET) return null;
  return (
    <div className="card vault-link-card" data-testid="vault-link">
      <span><b>Yield Vault</b> <span className="muted">· RWA yield on mainnet · unaudited, max {VAULT_DEPOSIT_CAP_XLM} XLM per deposit</span></span>
      <Link to="/vault" className="btn small">Open Yield Vault</Link>
    </div>
  );
}
