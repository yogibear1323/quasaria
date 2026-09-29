import { WORLD_ROWS, WORLD_STEP, WORLD_TOP } from "../lib/worldMask";

export type MapPin = { lat: number; lon: number; label: string; title: string; local: boolean; below?: boolean };

/** Dotted equirectangular world map (Natural Earth land mask) with highlighted pins. */
export default function WorldMap({ pins }: { pins: MapPin[] }) {
  const cols = WORLD_ROWS[0].length;
  const rows = WORLD_ROWS.length;
  const cell = 10;
  const W = cols * cell;
  const H = rows * cell;
  const px = (lon: number) => ((lon + 180) / WORLD_STEP) * cell;
  const py = (lat: number) => ((WORLD_TOP - lat) / WORLD_STEP) * cell;
  return (
    <svg className="world-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="World map highlighting the countries of verified local-currency stablecoins">
      {WORLD_ROWS.map((r, y) =>
        Array.from(r).map((c, x) => (c === "1" ? <circle key={`${x}-${y}`} cx={x * cell + cell / 2} cy={y * cell + cell / 2} r={2.1} fill="rgba(163,169,198,.24)" /> : null)),
      )}
      {pins.map((p) => (
        <g key={p.label} transform={`translate(${px(p.lon)},${py(p.lat)})`}>
          <circle r={16} fill={p.local ? "rgba(167,139,250,.2)" : "rgba(34,211,238,.16)"} className="pin-pulse" />
          <circle r={5.5} fill={p.local ? "#a78bfa" : "#22d3ee"} stroke="#06070d" strokeWidth={1.5} />
          <title>{p.title}</title>
          <text y={p.below ? 26 : -12} textAnchor="middle" className="pin-label">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
