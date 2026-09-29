/** Lightweight celebration effects: particle burst + optional chime. No assets, no deps. */

export const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const COLORS = ["#a78bfa", "#8b7cff", "#22d3ee", "#a5f3fc", "#ffffff", "#fbbf24"];

/** A short, light confetti/star burst from (x, y) in viewport px. Skipped under reduced motion. */
export function burst(x = window.innerWidth / 2, y = window.innerHeight / 3, count = 70) {
  if (prefersReducedMotion() || typeof document === "undefined") return;
  const c = document.createElement("canvas");
  c.className = "fx-canvas";
  c.setAttribute("aria-hidden", "true");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = window.innerWidth * dpr;
  c.height = window.innerHeight * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  if (!ctx) return c.remove();
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const v = 3 + Math.random() * 6;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.5, r: 1.5 + Math.random() * 2.8, c: COLORS[i % COLORS.length], star: Math.random() < 0.35, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 };
  });
  const t0 = performance.now(), life = 1300;
  const tick = (t: number) => {
    const k = (t - t0) / life;
    ctx.clearRect(0, 0, c.width, c.height);
    if (k >= 1) return c.remove();
    for (const p of parts) {
      p.vx *= 0.975; p.vy = p.vy * 0.975 + 0.16; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.star) {
        const R = p.r * 2.2, i = R * 0.25;
        ctx.beginPath(); ctx.moveTo(0, -R); ctx.quadraticCurveTo(i, -i, R, 0); ctx.quadraticCurveTo(i, i, 0, R); ctx.quadraticCurveTo(-i, i, -R, 0); ctx.quadraticCurveTo(-i, -i, 0, -R); ctx.fill();
      } else ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let audio: AudioContext | null = null;
/** Two-note "achievement" chime synthesised with WebAudio. Only called when the user turned sound on. */
export function chime(kind: "quest" | "badge" | "level" = "quest") {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const notes = kind === "level" ? [659.25, 830.61, 987.77, 1318.5] : kind === "badge" ? [783.99, 1174.66] : [880, 1318.5];
    const now = audio.currentTime;
    notes.forEach((f, i) => {
      const o = audio!.createOscillator(), g = audio!.createGain();
      o.type = "sine"; o.frequency.value = f;
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(audio!.destination);
      o.start(t); o.stop(t + 0.5);
    });
  } catch {
    /* audio is optional */
  }
}
