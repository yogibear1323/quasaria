// GitHub Pages: give deep-linked SPA routes a real 200 page (with and without a trailing slash) instead of the 404.html fallback.
import { copyFileSync, mkdirSync } from "node:fs";
for (const r of ["beacons"]) { copyFileSync("dist/index.html", `dist/${r}.html`); mkdirSync(`dist/${r}`, { recursive: true }); copyFileSync("dist/index.html", `dist/${r}/index.html`); }
