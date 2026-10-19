/**
 * Quasaria as a world: every feature has a district on the globe.
 * lat/lon in degrees on the Quasaria globe (not Earth). Order = keyboard/list order.
 */
export type Region = "Exchange Ridge" | "Yield Basin" | "Orbit Coast" | "Commons" | "Control";
export type District = {
  id: string; to: string; label: string; district: string; region: Region;
  lat: number; lon: number; hue: "violet" | "cyan" | "magenta"; blurb: string; external?: boolean;
};

export const DISTRICTS: District[] = [
  { id: "markets", to: "/markets", label: "Markets", district: "Signal Spire", region: "Exchange Ridge", lat: 34, lon: -18, hue: "cyan", blurb: "Live Stellar prices" },
  { id: "exchange", to: "/exchange", label: "Exchange", district: "Lightspeed Exchange", region: "Exchange Ridge", lat: 14, lon: 4, hue: "violet", blurb: "Order book trading" },
  { id: "swap", to: "/swap", label: "Swap", district: "Swap Bridge", region: "Exchange Ridge", lat: 26, lon: 30, hue: "cyan", blurb: "Simple swaps (coming soon)" },
  { id: "pools", to: "/pools", label: "Pools", district: "Liquidity Lakes", region: "Yield Basin", lat: -8, lon: 52, hue: "cyan", blurb: "Provide liquidity" },
  { id: "earn", to: "/earn", label: "Earnings", district: "Harvest Terraces", region: "Yield Basin", lat: 10, lon: 88, hue: "magenta", blurb: "Pool fees and rewards" },
  { id: "holders", to: "/holders", label: "Holders", district: "Glacier Hall", region: "Yield Basin", lat: 30, lon: 70, hue: "violet", blurb: "Daily holder rewards" },
  { id: "calculators", to: "/calculators", label: "Calculators", district: "Mirror Lab", region: "Yield Basin", lat: -48, lon: 42, hue: "cyan", blurb: "What-if math" },
  { id: "quests", to: "/quests", label: "Quests", district: "Quest Gate", region: "Commons", lat: -14, lon: -96, hue: "cyan", blurb: "Ranks and badges" },
  { id: "referral", to: "/referral", label: "Referral", district: "Signal Fires", region: "Yield Basin", lat: 52, lon: 100, hue: "magenta", blurb: "Invite friends (coming soon)" },
  { id: "activity", to: "/activity", label: "Activity", district: "Ledger Row", region: "Commons", lat: -30, lon: -120, hue: "cyan", blurb: "Your timeline (coming soon)" },
  { id: "buy", to: "/buy", label: "Buy", district: "Market Gate", region: "Commons", lat: 20, lon: -85, hue: "magenta", blurb: "Get XLM (coming soon)" },
  { id: "about", to: "/about", label: "About", district: "Base Camp", region: "Commons", lat: 8, lon: -140, hue: "violet", blurb: "What Quasaria is" },
  { id: "news", to: "/news", label: "News", district: "Broadcast Tower", region: "Commons", lat: 44, lon: -110, hue: "violet", blurb: "Stellar news" },
  { id: "merch", to: "/merch", label: "Merch", district: "Bazaar", region: "Commons", lat: -40, lon: -64, hue: "magenta", blurb: "Quasaria gear" },
];


export const REGIONS: Region[] = ["Exchange Ridge", "Yield Basin", "Orbit Coast", "Commons"];

export function districtFor(path: string): District | undefined {
  const exact = DISTRICTS.find((d) => d.to === path);
  if (exact) return exact;
  return [...DISTRICTS].sort((a, b) => b.to.length - a.to.length).find((d) => path.startsWith(d.to));
}

const R = Math.PI / 180;
/** Orthographic projection. rot = globe yaw (deg), tilt = pitch (deg). Returns x,y in [-1,1] and z>0 when front-facing. */
export function project(lat: number, lon: number, rot: number, tilt: number) {
  const la = lat * R, lo = (lon + rot) * R, t = tilt * R;
  const x = Math.cos(la) * Math.sin(lo);
  const y0 = Math.sin(la), z0 = Math.cos(la) * Math.cos(lo);
  const y = y0 * Math.cos(t) - z0 * Math.sin(t);
  const z = y0 * Math.sin(t) + z0 * Math.cos(t);
  return { x, y: -y, z };
}
