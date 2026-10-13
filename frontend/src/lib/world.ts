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
  { id: "trade", to: "/trade", label: "Trade", district: "Lightspeed Exchange", region: "Exchange Ridge", lat: 14, lon: 4, hue: "violet", blurb: "Swap and order book" },
  { id: "perps", to: "/perps", label: "Perps", district: "Warp Yard", region: "Exchange Ridge", lat: 40, lon: 26, hue: "magenta", blurb: "Perpetual futures" },
  { id: "chart", to: "/perps/chart", label: "XLM Chart", district: "Observatory", region: "Exchange Ridge", lat: 58, lon: 2, hue: "cyan", blurb: "Live XLM chart" },
  { id: "back-office", to: "/back-office", label: "Perps Bot Traders", district: "Control Deck", region: "Exchange Ridge", lat: 52, lon: 44, hue: "violet", blurb: "Orion, Echo, Nova & fleet · decision desk" },
  { id: "pools", to: "/pools", label: "Pools", district: "Liquidity Lakes", region: "Yield Basin", lat: -8, lon: 52, hue: "cyan", blurb: "Provide liquidity" },
  { id: "lending", to: "/lending", label: "Lend", district: "Blend Harbor", region: "Yield Basin", lat: -30, lon: 70, hue: "violet", blurb: "Blend XLM pool (default)" },
  { id: "earn", to: "/earn", label: "Earn", district: "Harvest Terraces", region: "Yield Basin", lat: 10, lon: 88, hue: "magenta", blurb: "Yield options" },
  { id: "calculators", to: "/calculators", label: "Calculators", district: "Mirror Lab", region: "Yield Basin", lat: -48, lon: 42, hue: "cyan", blurb: "What-if math" },
  { id: "stake", to: "/stake", label: "Stake", district: "Orbit Citadel", region: "Orbit Coast", lat: 22, lon: 128, hue: "violet", blurb: "Orbit staking" },
  { id: "beacons", to: "/beacons", label: "Beacons", district: "Beacon Heights", region: "Orbit Coast", lat: 46, lon: 150, hue: "magenta", blurb: "Preview · not deployed" },
  { id: "rewards", to: "/rewards", label: "QFX Mint & Rewards", district: "QFX Mint", region: "Orbit Coast", lat: -12, lon: 140, hue: "cyan", blurb: "Mint, redeem, rewards" },
  { id: "bots", to: "/bots", label: "Bots & Leverage", district: "Robot Foundry", region: "Orbit Coast", lat: -38, lon: 118, hue: "violet", blurb: "Automated strategies" },
  { id: "referrals", to: "/referrals", label: "Referrals", district: "Constellation Row", region: "Commons", lat: 18, lon: -72, hue: "magenta", blurb: "Invite and share fees" },
  { id: "quests", to: "/quests", label: "Quests", district: "Quest Gate", region: "Commons", lat: -14, lon: -96, hue: "cyan", blurb: "Ranks and badges" },
  { id: "news", to: "/news", label: "News", district: "Broadcast Tower", region: "Commons", lat: 44, lon: -110, hue: "violet", blurb: "Stellar news" },
  { id: "merch", to: "/merch", label: "Merch", district: "Bazaar", region: "Commons", lat: -40, lon: -64, hue: "magenta", blurb: "Quasaria gear" },
];

/** Autopay orbits Quasaria as a moon: an outer link, not a district. */
export const AUTOPAY = { label: "Autopay", href: "https://yogibear1323.github.io/autopay/", blurb: "Outer moon · separate app" };

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
