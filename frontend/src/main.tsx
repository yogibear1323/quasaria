import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./theme/global.css";
import "./theme/world.css";
import App from "./App";
import { WalletProvider } from "./lib/wallet";

// Old hash-style links (/quasaria/#/beacons) → real path routes before the router mounts.
{
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const m = location.hash.match(/^#(\/[\w\-/]*)(\?.*)?$/);
  if (m && m[1] !== "/") history.replaceState(null, "", `${base}${m[1]}${m[2] ?? ""}`);
}

// Stale-build recovery. GitHub Pages serves index.html with max-age=600 and every deploy deletes the old hashed
// chunks, so a phone holding an older index.html can show an old page or fail to load a lazy chunk (blank route).
if (import.meta.env.PROD) {
  const KEY = "qz.reloaded-for";
  const reloadOnce = (tag: string) => { if (sessionStorage.getItem(KEY) === tag) return; sessionStorage.setItem(KEY, tag); location.reload(); };
  // A lazy chunk from a previous deploy is gone: reload once to pick up the current index + chunks.
  window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); reloadOnce("preload:" + location.pathname); });
  // Re-fetch index.html from the network; if it points at a newer bundle than the one running, reload once.
  const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") ?? "";
  fetch(`${import.meta.env.BASE_URL}?fresh=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).then((html) => {
    const live = html.match(/assets\/index-[\w-]+\.js/)?.[0];
    if (live && mine && !mine.includes(live)) reloadOnce(live);
  }).catch(() => { /* offline: keep the running build */ });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
        <App />
      </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);

// Fade out the splash once React has painted.
requestAnimationFrame(() => {
  const s = document.getElementById("splash");
  if (s) {
    s.classList.add("gone");
    setTimeout(() => s.remove(), 600);
  }
});
