// GitHub Pages: give deep-linked SPA routes a real 200 page (with and without a trailing slash) instead of the 404.html fallback.
// (Vite's spa404 plugin and the SPA_ROUTES list in vite.config.ts cover the current routes; add extra ones here if needed.)
import { copyFileSync, mkdirSync } from "node:fs";
for (const r of []) { copyFileSync("dist/index.html", `dist/${r}.html`); mkdirSync(`dist/${r}`, { recursive: true }); copyFileSync("dist/index.html", `dist/${r}/index.html`); }
