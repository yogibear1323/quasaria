import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// VITE_BASE lets GitHub Pages serve the app under /<repo>/ (e.g. VITE_BASE=/quasaria/).
// Local dev/builds default to "/".
const base = process.env.VITE_BASE || "/";

// GitHub Pages has no SPA rewrites. So that deep links work:
//  - every top-level app route gets a copy of index.html as <route>.html, which Pages
//    serves for the extensionless URL (/quasaria/markets) with HTTP 200;
//  - any other path falls back to 404.html (a copy of index.html, served with HTTP 404).
// A route must not share its name with a folder in public/ (Pages would 301 /merch → /merch/
// instead of serving merch.html), so static assets live in e.g. public/merch-assets/.
// Harmless elsewhere (Netlify uses _redirects). Keep in sync with the routes in src/App.tsx.
const SPA_ROUTES = ["app", "markets", "trade", "pools", "earn", "calculators", "holders", "quests", "merch", "news", "exchange", "swap", "referral", "activity", "buy", "about", "wallet", "account", "deploy"];
let outDir = "dist";
let baseUrl = "/";

// merch.html gets its own head: yeti favicon / touch icon / social image, tab title, and the yeti mark on the splash.
// (The SPA also swaps the favicon + title at runtime for client-side visits; this covers deep links and link previews.)
const MERCH_TITLE = "Quasaria Supply — merch preview (coming soon)";
const MERCH_DESC = "Quasaria Supply merch preview: tees, a hoodie, a bomber, caps, a mug and stickers. Coming soon. Nothing is for sale yet.";
function merchHtml(html: string, base: string): string {
  const b = `${base}merch-assets/brand/`;
  const repo = process.env.GITHUB_REPOSITORY?.split("/");
  const origin = process.env.VITE_SITE_URL?.replace(/\/$/, "") || (repo ? `https://${repo[0]}.github.io` : "");
  const img = `${origin}${b}og-merch.jpg`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${MERCH_TITLE}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${MERCH_DESC}"`)
    .replace(/<link rel="icon" type="image\/svg\+xml"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${b}favicon-yeti.svg" />`)
    .replace(/<link rel="icon" type="image\/png" sizes="32x32"[^>]*>/, `<link rel="icon" type="image/png" sizes="32x32" href="${b}favicon-yeti-32.png" />`)
    .replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" sizes="180x180" href="${b}apple-touch-yeti.png" />`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1Quasaria Supply — Wear the Singularity"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${MERCH_DESC}"`)
    .replace(/(<meta property="og:image" content=")[^"]*"/, `$1${img}"\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630"`)
    .replace(/(<meta name="twitter:card" content="summary_large_image" \/>)/, `$1\n    <meta name="twitter:image" content="${img}" />`)
    .replace(/<img src="[^"]*logo-light\.svg" alt="Quasaria" \/>/, `<img src="${b}yeti-mark-192.png" alt="Quasaria" style="border-radius:22px" />`);
}
const spa404: Plugin = {
  name: "spa-404",
  apply: "build",
  configResolved(c) {
    outDir = resolve(c.root, c.build.outDir);
    baseUrl = c.base;
  },
  closeBundle() {
    const out = outDir;
    const index = resolve(out, "index.html");
    if (!existsSync(index)) return;
    for (const name of SPA_ROUTES) {
      const dir = resolve(out, name);
      if (existsSync(dir) && statSync(dir).isDirectory())
        throw new Error(`spa-404: dist/${name}/ collides with the /${name} route (GitHub Pages would redirect it). Rename that folder in public/.`);
    }
    for (const name of ["404", ...SPA_ROUTES]) copyFileSync(index, resolve(out, `${name}.html`));
    writeFileSync(resolve(out, "merch.html"), merchHtml(readFileSync(index, "utf8"), baseUrl));
  },
};

export default defineConfig({
  base,
  plugins: [react(), spa404],
  define: { global: "globalThis" },
  server: { port: 5173, host: "127.0.0.1" },
  preview: { port: 4173, host: "127.0.0.1" },
  build: { chunkSizeWarningLimit: 2500 },
});
