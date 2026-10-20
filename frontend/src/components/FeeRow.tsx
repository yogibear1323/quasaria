import { feePctText, feeText, type FeeLine } from "../lib/fees";

/** "Quasaria fee" row for a confirm/review <dl className="kv">. Renders nothing when there is no fee. */
export function FeeRow({ lines }: { lines: FeeLine[] }) {
  if (!lines.length) return null;
  return <div data-testid="quasaria-fee"><dt>Quasaria fee ({feePctText(lines[0].bps)})</dt><dd className="mono">{feeText(lines)}</dd></div>;
}
