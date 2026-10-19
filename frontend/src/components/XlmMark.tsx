import { XLM_LOGO } from "../lib/xlm";

/** The official Stellar symbol, for places that mean the native asset (XLM price pills). */
export default function XlmMark({ size = 16 }: { size?: number }) {
  return <img src={XLM_LOGO} alt="" width={size} height={size} data-testid="xlm-mark" style={{ borderRadius: "50%", verticalAlign: "-3px", marginRight: 5 }} />;
}
