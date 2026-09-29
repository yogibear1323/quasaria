import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QUESTS, RANKS, EXPLORE_PATHS, type GameState, type Quest } from "./engine";
import { useGame } from "./GameProvider";
import { prefersReducedMotion } from "./fx";

/** Number that eases to its new value (instant under reduced motion). */
export function AnimatedNumber({ value, duration = 900, format = (n: number) => Math.round(n).toLocaleString("en-US") }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  const from = useRef(shown);
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(value); return; }
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration), e = 1 - Math.pow(1 - k, 3);
      const v = start + (value - start) * e;
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num-anim">{format(shown)}</span>;
}

/**
 * Animates a pre-formatted numeric string like "$0.2273", "408.28K" or "12.00%"
 * from its previous value; the final text is exactly the input. Anything that
 * doesn't look like a single number is rendered unchanged.
 */
const NUM_RE = /^(\$?)(-?\d{1,3}(?:,\d{3})*|-?\d+)(\.\d+)?([A-Za-z%]{0,4})$/;
export function CountUpText({ text }: { text: string }) {
  const m = NUM_RE.exec(text.trim());
  if (!m) return <>{text}</>;
  const [, pre, int, frac = "", suf] = m;
  const dec = frac ? frac.length - 1 : 0;
  const n = Number(`${int.replace(/,/g, "")}${frac}`);
  const grouped = int.includes(",");
  const fmt = (v: number) => `${pre}${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: grouped })}${suf}`;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{Number.isFinite(n) ? <AnimatedNumber value={n} format={(v) => (Math.abs(v - n) < 1e-12 ? text : fmt(v))} /> : text}</span>
    </>
  );
}

export function XpBar({ progress, big }: { progress: number; big?: boolean }) {
  return (
    <div className={`xp-bar ${big ? "big" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="XP progress to next level">
      <div style={{ width: `${Math.max(2, progress * 100)}%` }} />
    </div>
  );
}

/** Hexagon with the level number. */
export function LevelHex({ level, size = 30 }: { level: number; size?: number }) {
  return (
    <span className="lvl-hex" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 32 32" width={size} height={size}>
        <defs>
          <linearGradient id="lvl-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#a78bfa" /><stop offset=".55" stopColor="#6d4aff" /><stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <path d="M16 1.5 28.6 8.75v14.5L16 30.5 3.4 23.25V8.75z" fill="url(#lvl-g)" stroke="rgba(255,255,255,.35)" />
      </svg>
      <b>{level}</b>
    </span>
  );
}

/** Small flame glyph for streaks (SVG so it renders everywhere, unlike emoji). */
export function Flame({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="flame">
      <path d="M8 1c.5 2.4 4.5 3.9 4.5 7.9A4.5 4.5 0 0 1 3.5 9c0-1.9 1-3.2 2.1-4.1.1 1.4.8 2.3 1.6 2.6C6.8 4.6 7.1 2.8 8 1z" fill="#fb923c" />
      <path d="M8 8c.3 1 2 1.7 2 3.4a2 2 0 0 1-4 0c0-.8.4-1.4.9-1.8.1.6.4 1 .7 1.1C7.4 9.6 7.6 8.8 8 8z" fill="#fde68a" />
    </svg>
  );
}

export const XP_NOTE = "XP, levels and badges are just for fun: they have no monetary value, are not a token, can't be traded or redeemed, and live only in this browser.";

export const questProgress = (s: GameState, q: Quest): [number, number] | null => {
  if (q.id === "explore") return [s.visited.filter((p) => (EXPLORE_PATHS as readonly string[]).includes(p)).length, EXPLORE_PATHS.length];
  if (q.id === "streak-3") return [Math.min(3, s.streak.count), 3];
  if (q.id === "streak-7") return [Math.min(7, s.streak.count), 7];
  return null;
};

/** Header chip: level hex, rank, XP bar. Opens the quest widget. */
export function LevelBadge() {
  const g = useGame();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  if (!g) return null;
  const { info, state } = g;
  const next = QUESTS.filter((q) => !state.done[q.id]).slice(0, 3);
  return (
    <div className="lvl-wrap" ref={box}>
      <button className="lvl-badge" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" title={`Level ${info.level} · ${info.rank} · ${info.xp} XP`} data-testid="level-badge">
        <LevelHex level={info.level} />
        <span className="lvl-meta">
          <span className="lvl-rank">{info.rank}</span>
          <XpBar progress={info.progress} />
        </span>
        {state.streak.count > 0 && <span className="lvl-streak" title={`${state.streak.count}-day visit streak`}><Flame />{state.streak.count}</span>}
      </button>
      {open && (
        <div className="card lvl-pop" role="dialog" aria-label="Your progress">
          <div className="row between">
            <div>
              <div className="lvl-pop-rank">Level {info.level} · {info.rank}</div>
              <div className="muted l-tiny"><AnimatedNumber value={info.xp} /> XP{info.next !== null ? ` · ${info.next - info.xp} to level ${info.level + 1}` : " · max level"}</div>
            </div>
            <span className="pill gold" title="Daily visit streak"><Flame /> {state.streak.count} day{state.streak.count === 1 ? "" : "s"}</span>
          </div>
          <XpBar progress={info.progress} big />
          <div className="lvl-pop-h">Next quests</div>
          <ul className="quest-mini">
            {next.length ? next.map((q) => (
              <li key={q.id}>
                <span className="qm-dot" aria-hidden />
                <span className="qm-t">{q.to ? <Link to={q.to} onClick={() => setOpen(false)}>{q.title}</Link> : q.title}</span>
                <span className="xp-chip">+{q.xp}</span>
              </li>
            )) : <li className="muted">All quests complete. Nice work, {info.rank}!</li>}
          </ul>
          <div className="row between" style={{ marginTop: 12 }}>
            <Link to="/quests" className="btn small" onClick={() => setOpen(false)}>All quests & badges →</Link>
            <SoundToggle />
          </div>
          <p className="muted xp-note">{XP_NOTE}</p>
        </div>
      )}
    </div>
  );
}

export function SoundToggle() {
  const g = useGame();
  if (!g) return null;
  return (
    <label className="switch" title="Play a short chime when you complete a quest">
      <input type="checkbox" checked={g.sound} onChange={(e) => g.setSound(e.target.checked)} />
      <span className="switch-ui" aria-hidden />
      <span className="switch-l">Sound {g.sound ? "on" : "off"}</span>
    </label>
  );
}

export function RankLadder({ level }: { level: number }) {
  return (
    <ol className="rank-ladder">
      {RANKS.map((r, i) => {
        const on = level >= r.minLevel, cur = on && (i === RANKS.length - 1 || level < RANKS[i + 1].minLevel);
        return (
          <li key={r.name} className={`${on ? "on" : ""} ${cur ? "cur" : ""}`} title={r.blurb}>
            <span className="rl-dot" aria-hidden />
            <b>{r.name}</b>
            <span className="muted">Lv {r.minLevel}+</span>
          </li>
        );
      })}
    </ol>
  );
}
