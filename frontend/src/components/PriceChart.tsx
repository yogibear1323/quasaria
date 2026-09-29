type Candle = { t: number; o: number; h: number; l: number; c: number };

/** Glowing SVG candlestick chart. */
export default function PriceChart({ candles, height = 260 }: { candles: Candle[]; height?: number }) {
  const W = 720, H = height, pad = 8;
  if (!candles.length) return null;
  const hi = Math.max(...candles.map((c) => c.h)), lo = Math.min(...candles.map((c) => c.l));
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const cw = (W - pad * 2) / candles.length;
  const line = candles.map((c, i) => `${i ? "L" : "M"}${pad + i * cw + cw / 2},${y(c.c)}`).join(" ");
  const area = `${line} L${pad + (candles.length - 0.5) * cw},${H} L${pad + cw / 2},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Price chart">
      <defs>
        <linearGradient id="pc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.3" />
          <stop offset="1" stopColor="#7c5cff" stopOpacity="0" />
        </linearGradient>
        <filter id="pc-glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 6" />
      ))}
      <path d={area} fill="url(#pc-area)" />
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const x = pad + i * cw;
        const col = up ? "#34d399" : "#fb7185";
        return (
          <g key={i} opacity={0.9}>
            <line x1={x + cw / 2} x2={x + cw / 2} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
            <rect x={x + cw * 0.2} width={cw * 0.6} y={y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} fill={col} rx={1} />
          </g>
        );
      })}
      <path d={line} fill="none" stroke="#22d3ee" strokeWidth={2} filter="url(#pc-glow)" />
    </svg>
  );
}
