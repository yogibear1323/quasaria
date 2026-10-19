import { useEffect, useState, type ReactNode } from "react";
import { useCountUp, tierProgress } from "../lib/motion";

/** Drifting snow behind the page header. Decorative only: aria-hidden, no pointer events, transform/opacity only. */
export function Snowfield({ count = 18 }: { count?: number }) {
  return (
    <div className="snowfield" aria-hidden data-testid="snowfield">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ left: `${(i * 53) % 100}%`, animationDelay: `${-((i * 1.7) % 12)}s`, animationDuration: `${10 + (i % 5) * 2.5}s`, ["--s" as string]: `${0.5 + ((i * 7) % 5) / 6}` }} />
      ))}
    </div>
  );
}

/** A number that counts up to its real value. While the value is unknown it renders `placeholder` unchanged. */
export function CountUp({ value, format, placeholder = "–", testid }: { value: number | null; format: (n: number) => string; placeholder?: ReactNode; testid?: string }) {
  const v = useCountUp(value);
  return <span className="count-up" data-testid={testid} data-final={value === null ? undefined : format(value)}>{v === null ? placeholder : format(v)}</span>;
}

/** false on the first paint, true one frame later, so bars grow from 0 to their real value via a CSS transition. */
function useArmed() {
  const [on, setOn] = useState(false);
  useEffect(() => { if (typeof requestAnimationFrame === "undefined") return setOn(true); const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  return on;
}

/** Progress toward 1M / 10M. The fill scales (transform) to the real fraction; a frost shimmer runs over it. */
export function TierProgress({ balance }: { balance: number | null }) {
  const p = tierProgress(balance);
  const on = useArmed();
  return (
    <div className="tier-progress" data-testid="tier-progress" role="img" aria-label={p === null ? "Tier progress unknown" : `Tier progress ${Math.round(p * 100)}% of the way to 10M`}>
      <div className="tp-track"><div className="tp-fill" style={{ transform: `scaleX(${on ? p ?? 0 : 0})` }} data-p={p ?? ""} /></div>
      <div className="tp-marks"><span style={{ left: "50%" }}>1M</span><span style={{ left: "100%" }}>10M</span></div>
    </div>
  );
}

/** Reserve gauge: share of the original reward reserve still held. `null` keeps the gauge empty. */
export function ReserveGauge({ fraction }: { fraction: number | null }) {
  const f = fraction === null || !Number.isFinite(fraction) ? null : Math.max(0, Math.min(1, fraction));
  const on = useArmed();
  return (
    <div className="reserve-gauge" data-testid="reserve-gauge" role="img" aria-label={f === null ? "Reserve level unknown" : `Reserve ${Math.round(f * 100)}% of the original allocation`}>
      <div className="rg-fill" style={{ transform: `scaleX(${on ? f ?? 0 : 0})` }} data-f={f ?? ""} />
    </div>
  );
}

/** Small yeti mark that glints and waves once, shown only when the user actually qualifies. */
export function YetiGlint({ src }: { src: string }) {
  return <span className="yeti-glint" data-testid="yeti-glint" aria-hidden><img src={src} alt="" width={28} height={28} /></span>;
}
