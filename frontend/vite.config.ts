import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// VITE_BASE lets GitHub Pages serve the app under /<repo>/ (e.g. VITE_BASE=/quasaria/).
// Local dev/builds default to "/".
const base = process.env.VITE_BASE || "/";

// GitHub Pages has no SPA rewrites: serve the app shell for unknown paths (deep links)
// by shipping a copy of index.html as 404.html. Harmless elsewhere (Netlify uses _redirects).
let outDir = "dist";
const spa404: Plugin = {
  name: "spa-404",
  apply: "build",
  configResolved(c) {
    outDir = resolve(c.root, c.build.outDir);
  },
  closeBundle() {
    const out = outDir;
    if (existsSync(resolve(out, "index.html"))) copyFileSync(resolve(out, "index.html"), resolve(out, "404.html"));
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
