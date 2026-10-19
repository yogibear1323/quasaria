/**
 * The single source of truth for the top navigation (desktop row and mobile menu).
 * Order: [Markets | Exchange | Pools] segmented group, then Swap as its own tab, then the individual items.
 */
import type { Scene } from "../world/WorldBackground";

export type NavItem = { to: string; label: string; scene: Scene };

/** The segmented toggle group. Exactly these three, in this order. Swap is NOT part of it. */
export const NAV_GROUP: NavItem[] = [
  { to: "/markets", label: "Markets", scene: "constellation" },
  { to: "/exchange", label: "Exchange", scene: "quasar" },
  { to: "/pools", label: "Pools", scene: "nebula" },
];
/** Swap: its own standalone top-level tab, directly after the group. */
export const NAV_SWAP: NavItem = { to: "/swap", label: "Swap", scene: "quasar" };
/** Individual items after Swap. */
export const NAV_REST: NavItem[] = [
  { to: "/earn", label: "Earnings", scene: "supernova" },
  { to: "/holders", label: "Holders", scene: "supernova" },
  { to: "/referral", label: "Referral", scene: "supernova" },
  { to: "/activity", label: "Activity", scene: "constellation" },
  { to: "/news", label: "News", scene: "constellation" },
  { to: "/buy", label: "Buy", scene: "nebula" },
  { to: "/about", label: "About", scene: "constellation" },
];
/** Full top-row order. */
export const NAV_ALL: NavItem[] = [...NAV_GROUP, NAV_SWAP, ...NAV_REST];
/** Pages still reachable by URL / the world map but not in the top row. */
export const NAV_MORE: { to: string; label: string; scene: Scene }[] = [
  { to: "/quests", label: "Quests", scene: "constellation" },
  { to: "/merch", label: "Merch", scene: "nebula" },
  { to: "/calculators", label: "Calculators", scene: "orbits" },
];
/** Old URLs that redirect (query string is kept, e.g. /trade?base=… → /exchange?base=…). */
export const REDIRECTS: Record<string, string> = { "/trade": "/exchange", "/app": "/exchange" };

export const isActive = (path: string, to: string) => path === to || path.startsWith(`${to}/`);
export function sceneFor(path: string): Scene {
  if (path.startsWith("/calculators")) return "orbits";
  return [...NAV_ALL, ...NAV_MORE].find((n) => isActive(path, n.to))?.scene ?? "quasar";
}
