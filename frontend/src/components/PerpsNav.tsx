/**
 * "Perps" top-nav item with a submenu (Perps trade, Back Office robot floor).
 * Opens on hover, keyboard focus, or the caret (touch). The menu is portalled with fixed positioning so the scrollable
 * nav strip cannot clip it. Esc closes and returns focus; ArrowDown/ArrowUp move through items.
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";

export const PERPS_MENU = [
  { to: "/perps", label: "Perps", sub: "trade long / short" },
  { to: "/back-office", label: "Back Office · robot floor", sub: "six bots · demo account" },
];
export const isPerpsPath = (p: string) => p.startsWith("/perps") || p.startsWith("/back-office");

export function PerpsNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = isPerpsPath(pathname);

  const place = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), top: r.bottom + 6 });
  };
  const openedAt = useRef(0);
  const isOpen = useRef(false);
  isOpen.current = open;
  const show = () => {
    clearTimeout(timer.current);
    if (!isOpen.current) openedAt.current = Date.now();
    isOpen.current = true;
    place();
    setOpen(true);
  };
  const hide = (ms = 160) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), ms);
  };
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const off = () => setOpen(false);
    const out = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("resize", off);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", out);
    return () => {
      window.removeEventListener("resize", off);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", out);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []);
  const focusItem = (i: number) => requestAnimationFrame(() => items()[i]?.focus());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      link.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const list = items();
      const cur = list.indexOf(document.activeElement as HTMLAnchorElement);
      if (!open) show();
      focusItem(cur < 0 ? 0 : (cur + 1) % Math.max(1, list.length));
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      const list = items();
      const cur = list.indexOf(document.activeElement as HTMLAnchorElement);
      focusItem(cur <= 0 ? list.length - 1 : cur - 1);
    }
  };
  const onBlur = (e: FocusEvent) => {
    const t = e.relatedTarget as Node | null;
    if (t && (wrap.current?.contains(t) || menu.current?.contains(t))) return;
    hide(0);
  };

  return (
    <>
      <div className={`nav-dd ${open ? "open" : ""}`} ref={wrap} onPointerEnter={(e) => e.pointerType === "mouse" && show()} onPointerLeave={(e) => e.pointerType === "mouse" && hide()} onFocus={show} onBlur={onBlur} onKeyDown={onKey}>
        <NavLink ref={link} to="/perps" className={() => (active ? "active" : "")} aria-haspopup="menu" aria-expanded={open} aria-controls="perps-menu">
          Perps
        </NavLink>
        <button type="button" className="nav-caret" aria-label="Perps menu" aria-haspopup="menu" aria-expanded={open} aria-controls="perps-menu" onClick={() => {
            // touch: the tap's synthetic hover/focus may have just opened the menu — keep it open instead of toggling shut
            if (isOpen.current && Date.now() - openedAt.current > 400) setOpen(false);
            else (show(), focusItem(0));
          }}>
          <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div id="perps-menu" role="menu" aria-label="Perps" ref={menu} className="nav-menu" style={{ left: pos.left, top: pos.top }} onPointerEnter={(e) => e.pointerType === "mouse" && show()} onPointerLeave={(e) => e.pointerType === "mouse" && hide()} onKeyDown={onKey} onBlur={onBlur}>
            {PERPS_MENU.map((m) => (
              <NavLink key={m.to} to={m.to} role="menuitem" className={({ isActive }) => (isActive ? "on" : "")} onClick={() => setOpen(false)}>
                <b>{m.label}</b>
                <small>{m.sub}</small>
              </NavLink>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
