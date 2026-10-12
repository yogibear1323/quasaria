import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { districtFor } from "../lib/world";
import WorldList from "./WorldList";

const Globe = lazy(() => import("./Globe"));

/** Inner-page navigation: a compact orbit button showing the current district; opens the world panel (mini globe + full list). */
export default function WorldNav() {
  const loc = useLocation();
  const here = districtFor(loc.pathname);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    window.addEventListener("keydown", k);
    panel.current?.querySelector<HTMLElement>("a,[tabindex='0']")?.focus();
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  return (
    <div className="world-nav">
      <button ref={btn} className="wn-btn" aria-expanded={open} aria-controls="world-panel" onClick={() => setOpen((o) => !o)}>
        <span className="wn-orb" aria-hidden><i /></span>
        <span className="wn-txt"><small>Quasaria world</small><b>{here ? here.label : "Explore"}</b></span>
        <span aria-hidden className="wn-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="wn-scrim" onClick={() => setOpen(false)} />
          <div id="world-panel" ref={panel} className="wn-panel" role="dialog" aria-label="Quasaria world map">
            <div className="wn-globe">
              <Suspense fallback={<div className="globe-loading" />}><Globe compact current={here?.id} onNavigate={() => setOpen(false)} /></Suspense>
            </div>
            <WorldList current={here?.id} onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
