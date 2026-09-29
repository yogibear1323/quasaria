import { useEffect, useRef } from "react";

/**
 * Animated, per-page cosmic scenes rendered on a single <canvas>.
 *
 *  quasar        – Trade:     spinning accretion disk + twin relativistic jets
 *  nebula        – Pools:     drifting luminous gas clouds + twinkling stars
 *  orbits        – Stake:     planets orbiting a golden star on tilted rings
 *  supernova     – Rewards:   expanding shock rings + outward-spiralling sparks (compounding!)
 *  constellation – Referrals: drifting stars that link up into constellations (your network)
 *  warp          – Bots:      hyperspace streaks (leverage = warp speed)
 *
 * All scenes share a parallax starfield. Honors prefers-reduced-motion by
 * rendering a single static frame.
 */
export type Scene = "quasar" | "nebula" | "orbits" | "supernova" | "constellation" | "warp";

type Star = { x: number; y: number; z: number; r: number; tw: number; hue: number };

// v2 palette: on-brand violet → cyan, with muted warm accents.
const PALETTE = {
  cyan: [34, 211, 238],
  pink: [167, 139, 250],
  violet: [124, 92, 255],
  gold: [251, 191, 36],
  orange: [251, 146, 60],
  green: [52, 211, 153],
  red: [251, 113, 133],
};
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function CosmicBackground({ scene }: { scene: Scene }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const rand = mulberry32(42);
    let w = 0, h = 0, dpr = 1, raf = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const stars: Star[] = Array.from({ length: 260 }, () => ({
      x: rand(), y: rand(), z: rand() * 0.9 + 0.1, r: rand() * 1.3 + 0.2, tw: rand() * Math.PI * 2, hue: rand(),
    }));
    // disk particles for quasar
    const disk = Array.from({ length: 420 }, () => ({
      a: rand() * Math.PI * 2, rr: 0.35 + rand() * 0.65, s: 0.4 + rand() * 0.8, c: rand(),
    }));
    // nebula clouds
    const clouds = Array.from({ length: 9 }, (_, i) => ({
      x: rand(), y: rand(), r: 0.18 + rand() * 0.25, vx: (rand() - 0.5) * 0.00012, vy: (rand() - 0.5) * 0.0001,
      c: [PALETTE.pink, PALETTE.violet, PALETTE.cyan][i % 3],
    }));
    // orbits
    const planets = Array.from({ length: 6 }, (_, i) => ({
      r: 0.12 + i * 0.085, a: rand() * Math.PI * 2, s: 0.0009 / (1 + i * 0.6), size: 3 + rand() * 7,
      c: [PALETTE.cyan, PALETTE.pink, PALETTE.violet, PALETTE.gold, PALETTE.green, PALETTE.orange][i],
    }));
    // supernova sparks
    const sparks = Array.from({ length: 240 }, () => ({ a: rand() * Math.PI * 2, d: rand(), s: 0.0006 + rand() * 0.0016, c: rand() }));
    // constellation nodes
    const nodes = Array.from({ length: 70 }, () => ({
      x: rand(), y: rand(), vx: (rand() - 0.5) * 0.00018, vy: (rand() - 0.5) * 0.00018, big: rand() < 0.15,
    }));
    // warp streaks
    const warp = Array.from({ length: 360 }, () => ({ a: rand() * Math.PI * 2, d: rand(), s: 0.004 + rand() * 0.012, c: rand() }));

    const drawStars = (t: number, parallax: number) => {
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(t * 0.002 * (0.5 + s.z) + s.tw);
        const x = ((s.x + parallax * s.z) % 1 + 1) % 1;
        const col = s.hue < 0.12 ? PALETTE.cyan : s.hue < 0.2 ? PALETTE.pink : [238, 241, 255];
        ctx.fillStyle = rgba(col, tw * (0.35 + s.z * 0.65));
        ctx.beginPath();
        ctx.arc(x * w, s.y * h, s.r * (0.6 + s.z), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const glow = (x: number, y: number, r: number, c: number[], a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, a));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const scenes: Record<Scene, (t: number) => void> = {
      quasar: (t) => {
        drawStars(t, t * 0.000004);
        const cx = w * 0.74, cy = h * 0.3, R = Math.min(w, h) * 0.32;
        const tilt = -0.45;
        ctx.globalCompositeOperation = "lighter";
        // jets
        const pulse = 0.6 + 0.4 * Math.sin(t * 0.003);
        for (const dir of [-1, 1]) {
          const jx = cx + Math.cos(tilt - Math.PI / 2) * R * 1.9 * dir;
          const jy = cy + Math.sin(tilt - Math.PI / 2) * R * 1.9 * dir;
          const g = ctx.createLinearGradient(cx, cy, jx, jy);
          g.addColorStop(0, rgba([230, 253, 255], 0.55 * pulse));
          g.addColorStop(0.4, rgba(PALETTE.cyan, 0.25 * pulse));
          g.addColorStop(1, rgba(PALETTE.violet, 0));
          ctx.strokeStyle = g;
          ctx.lineWidth = 10;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(jx, jy); ctx.stroke();
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(jx, jy); ctx.stroke();
        }
        // disk particles
        for (const p of disk) {
          p.a += 0.0025 * p.s / p.rr;
          const ex = Math.cos(p.a) * R * p.rr, ey = Math.sin(p.a) * R * p.rr * 0.32;
          const x = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
          const y = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt);
          const col = p.rr < 0.5 ? [255, 243, 200] : p.c < 0.5 ? PALETTE.orange : p.c < 0.8 ? PALETTE.pink : PALETTE.violet;
          ctx.fillStyle = rgba(col, 0.55 * (1.2 - p.rr));
          ctx.beginPath(); ctx.arc(x, y, 1.6 * (1.3 - p.rr) + 0.4, 0, Math.PI * 2); ctx.fill();
        }
        glow(cx, cy, R * 0.55, PALETTE.cyan, 0.35);
        glow(cx, cy, R * 0.18, [255, 255, 255], 0.9);
        ctx.globalCompositeOperation = "source-over";
      },
      nebula: (t) => {
        ctx.globalCompositeOperation = "lighter";
        for (const c of clouds) {
          c.x += c.vx; c.y += c.vy;
          if (c.x < -0.2 || c.x > 1.2) c.vx *= -1;
          if (c.y < -0.2 || c.y > 1.2) c.vy *= -1;
          const breathe = 0.8 + 0.2 * Math.sin(t * 0.0006 + c.r * 10);
          glow(c.x * w, c.y * h, c.r * Math.max(w, h) * breathe, c.c, 0.16);
        }
        ctx.globalCompositeOperation = "source-over";
        drawStars(t, t * 0.000002);
      },
      orbits: (t) => {
        drawStars(t, 0);
        const cx = w * 0.72, cy = h * 0.58, S = Math.min(w, h);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, 0.42);
        for (const p of planets) {
          ctx.strokeStyle = rgba(p.c, 0.22);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(0, 0, p.r * S, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
        ctx.globalCompositeOperation = "lighter";
        glow(cx, cy, S * 0.16, PALETTE.gold, 0.55);
        glow(cx, cy, S * 0.05, [255, 255, 255], 0.9);
        for (const p of planets) {
          p.a += p.s * 16;
          const x = cx + Math.cos(p.a) * p.r * S, y = cy + Math.sin(p.a) * p.r * S * 0.42;
          glow(x, y, p.size * 3.2, p.c, 0.35);
          ctx.fillStyle = rgba(p.c, 0.95);
          ctx.beginPath(); ctx.arc(x, y, p.size * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      },
      supernova: (t) => {
        drawStars(t, 0);
        const cx = w * 0.5, cy = h * 0.42, M = Math.max(w, h);
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 4; i++) {
          const ph = ((t * 0.00018 + i / 4) % 1);
          ctx.strokeStyle = rgba(i % 2 ? PALETTE.pink : PALETTE.gold, 0.45 * (1 - ph));
          ctx.lineWidth = 3 * (1 - ph) + 0.5;
          ctx.beginPath(); ctx.arc(cx, cy, ph * M * 0.6, 0, Math.PI * 2); ctx.stroke();
        }
        for (const s of sparks) {
          s.d += s.s;
          if (s.d > 1) s.d = 0;
          const ang = s.a + s.d * 2.2; // spiral out = compounding
          const r = s.d * s.d * M * 0.55;
          const col = s.c < 0.4 ? PALETTE.gold : s.c < 0.75 ? PALETTE.orange : PALETTE.pink;
          ctx.fillStyle = rgba(col, 0.8 * (1 - s.d));
          ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 1.2 + s.d * 1.8, 0, Math.PI * 2); ctx.fill();
        }
        glow(cx, cy, M * 0.09 * (0.9 + 0.1 * Math.sin(t * 0.004)), [255, 240, 200], 0.7);
        ctx.globalCompositeOperation = "source-over";
      },
      constellation: (t) => {
        drawStars(t, t * 0.000001);
        for (const n of nodes) {
          n.x += n.vx; n.y += n.vy;
          if (n.x < 0 || n.x > 1) n.vx *= -1;
          if (n.y < 0 || n.y > 1) n.vy *= -1;
        }
        const maxD = 0.14;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const dx = (a.x - b.x) * (w / h), dy = a.y - b.y;
            const d = Math.hypot(dx, dy);
            if (d < maxD) {
              ctx.strokeStyle = rgba(PALETTE.cyan, 0.5 * (1 - d / maxD));
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
            }
          }
        }
        ctx.globalCompositeOperation = "lighter";
        for (const n of nodes) {
          const c = n.big ? PALETTE.green : PALETTE.cyan;
          glow(n.x * w, n.y * h, n.big ? 16 : 7, c, 0.5);
          ctx.fillStyle = rgba([255, 255, 255], 0.95);
          ctx.beginPath(); ctx.arc(n.x * w, n.y * h, n.big ? 2.4 : 1.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      },
      warp: () => {
        const cx = w * 0.5, cy = h * 0.5, M = Math.hypot(w, h) * 0.6;
        ctx.globalCompositeOperation = "lighter";
        for (const s of warp) {
          s.d += s.s * (0.3 + s.d * 2);
          if (s.d > 1) s.d = 0.02;
          const r1 = s.d * s.d * M, r2 = Math.min(1, s.d + 0.06) ** 2 * M;
          const col = s.c < 0.5 ? PALETTE.cyan : s.c < 0.8 ? PALETTE.violet : PALETTE.pink;
          ctx.strokeStyle = rgba(col, Math.min(1, s.d * 1.6));
          ctx.lineWidth = 0.6 + s.d * 2.2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
          ctx.lineTo(cx + Math.cos(s.a) * r2, cy + Math.sin(s.a) * r2);
          ctx.stroke();
        }
        glow(cx, cy, 90, PALETTE.red, 0.25);
        ctx.globalCompositeOperation = "source-over";
      },
    };

    const frame = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      scenes[scene](t);
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [scene]);

  return (
    <div className={`cosmos scene-${scene}`} aria-hidden>
      <div className="nebula-layer" />
      <canvas ref={ref} />
      <div className="vignette" />
    </div>
  );
}
