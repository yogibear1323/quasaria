import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// VITE_BASE lets GitHub Pages serve the app under /<repo>/ (e.g. VITE_BASE=/quasaria/).
// Local dev/builds default to "/".
const base = process.env.VITE_BASE || "/";

// GitHub Pages has no SPA rewrites. So that deep links work:
//  - every top-level app route gets a copy of index.html as <route>.html, which Pages
//    serves for the extensionless URL (/quasaria/markets) with HTTP 200;
//  - any other path falls back to 404.html (a copy of index.html, served with HTTP 404).
// Harmless elsewhere (Netlify uses _redirects). Keep in sync with the routes in src/App.tsx.
const SPA_ROUTES = ["app", "markets", "trade", "pools", "stake", "rewards", "referrals", "bots"];
let outDir = "dist";
const spa404: Plugin = {
  name: "spa-404",
  apply: "build",
  configResolved(c) {
    outDir = resolve(c.root, c.build.outDir);
  },
  closeBundle() {
    const out = outDir;
    const index = resolve(out, "index.html");
    if (!existsSync(index)) return;
    for (const name of ["404", ...SPA_ROUTES]) copyFileSync(index, resolve(out, `${name}.html`));
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
