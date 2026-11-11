import { MERCH_TITLE } from "../merch/catalog";
import { NAV_ALL, NAV_KEY, NAV_MORE } from "./nav";

/** Landing tab title. Also the fallback for an unknown route. */
export const DEFAULT_DOCUMENT_TITLE = "Quasaria — Trade on the Stellar Decentralized Exchange";

/** Tab title for a pathname. App routes are owned here so leaving a page cannot leave the previous title behind. */
export function titleForPath(pathname: string): string {
  const path = (pathname.split("?")[0].split("#")[0] || "/").replace(/\/+$/, "") || "/";
  if (path === "/") return DEFAULT_DOCUMENT_TITLE;
  if (path === "/news") return "Stellar news · Quasaria";
  if (path === "/merch") return MERCH_TITLE;
  const item = [...NAV_ALL, ...NAV_MORE, ...NAV_KEY].find((n) => n.to === path);
  return item ? `${item.label} · Quasaria` : DEFAULT_DOCUMENT_TITLE;
}
