import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { NAV_ALL, NAV_GROUP, NAV_MORE, NAV_REST, NAV_SWAP, REDIRECTS, isActive, sceneFor } from "../src/lib/nav";
import { MainNav, MobileMenu } from "../src/components/Layout";
import { DISTRICTS } from "../src/lib/world";

const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

describe("top navigation order", () => {
  it("group is exactly Markets | Exchange | Pools, in that order, and Swap is not in it", () => {
    expect(labels(NAV_GROUP)).toEqual(["Markets", "Exchange", "Pools"]);
    expect(NAV_GROUP.some((n) => n.to === NAV_SWAP.to)).toBe(false);
  });
  it("Swap is its own tab right after the group, then the individual items", () => {
    expect(NAV_SWAP.label).toBe("Swap");
    expect(labels(NAV_ALL)).toEqual(["Markets", "Exchange", "Pools", "Swap", "Yield Vault", "Earnings", "Holders", "Activity", "News", "Buy", "About"]);
    expect(labels(NAV_REST)).toEqual(["Yield Vault", "Earnings", "Holders", "Activity", "News", "Buy", "About"]);
  });
  it("has no Trade item and no duplicate paths", () => {
    expect(labels([...NAV_ALL, ...NAV_MORE]).includes("Trade")).toBe(false);
    const paths = [...NAV_ALL, ...NAV_MORE].map((n) => n.to);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it("/trade and /app redirect to /exchange", () => {
    expect(REDIRECTS["/trade"]).toBe("/exchange");
    expect(REDIRECTS["/app"]).toBe("/exchange");
  });
  it("every nav link resolves: it is a served SPA route (GitHub Pages 404 fallback) and a world-map district", () => {
    const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    const spa = /const SPA_ROUTES = \[([^\]]*)\]/.exec(cfg)![1].match(/"([^"]+)"/g)!.map((s) => s.replace(/"/g, ""));
    for (const n of [...NAV_ALL, ...NAV_MORE, ...Object.keys(REDIRECTS).map((to) => ({ to }))]) expect(spa, n.to).toContain(n.to.slice(1));
    for (const n of NAV_ALL) expect(DISTRICTS.some((d) => d.to === n.to), n.to).toBe(true);
    expect(DISTRICTS.some((d) => d.to === "/trade")).toBe(false);
  });
  it("active state matches the path and nested paths only", () => {
    expect(isActive("/exchange", "/exchange")).toBe(true);
    expect(isActive("/exchange/x", "/exchange")).toBe(true);
    expect(isActive("/exchanger", "/exchange")).toBe(false);
    expect(sceneFor("/swap")).toBe("quasar");
  });
});

describe("rendered nav", () => {
  const desktop = renderToStaticMarkup(<MemoryRouter initialEntries={["/swap"]}><MainNav path="/swap" /></MemoryRouter>);
  const mobile = renderToStaticMarkup(<MemoryRouter><MobileMenu path="/swap" /></MemoryRouter>);
  const text = (h: string) => [...h.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
  it("desktop: group wraps exactly three links; Swap sits outside it, visible, and is active on /swap", () => {
    const group = /data-testid="nav-group"[^>]*>(.*?)<\/div>/.exec(desktop)![1];
    expect(text(group)).toEqual(["Markets", "Exchange", "Pools"]);
    expect(text(desktop)).toEqual(["Markets", "Exchange", "Pools", "Swap", "Yield Vault", "Earnings", "Holders", "Activity", "News", "Buy", "About"]);
    expect(desktop).toMatch(/data-testid="nav-swap"[^>]*aria-current="page"|aria-current="page"[^>]*class="nav-swap active"/);
    expect(desktop.indexOf('data-testid="nav-group"')).toBeLessThan(desktop.indexOf("nav-swap"));
    expect(/data-testid="nav-group"[^>]*>.*?<\/div>.*nav-swap/.test(desktop)).toBe(true); // Swap comes after the group closes
  });
  it("mobile menu: every item is top level, in order, Swap outside the segmented group (menu starts closed)", () => {
    expect(mobile).toContain("☰ Menu");
    expect(mobile).not.toContain('id="mm-panel"');
    const open = renderToStaticMarkup(<MemoryRouter><MobileMenu path="/swap" defaultOpen /></MemoryRouter>);
    const group = /role="group"[^>]*>(.*?)<\/div>/.exec(open)![1];
    expect(text(group)).toEqual(["Markets", "Exchange", "Pools"]);
    expect(text(open)).toEqual(["Markets", "Exchange", "Pools", "Swap", "Yield Vault", "Earnings", "Holders", "Activity", "News", "Buy", "About", "Quests", "Merch", "Calculators", "Deploy info"]);
  });
});
