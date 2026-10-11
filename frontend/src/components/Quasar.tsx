import "../theme/quasar.css";
// Quasaria Quasar: original hero visual (SVG + CSS, no images, no libraries).
// Luminous core, tilted violet->cyan accretion disk (slow CSS rotation, compositor-only),
// faint relativistic jets, soft halo, subtle star field and nebula haze. Decorative only.
const STARS = (() => {
  let s = 1337; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 70 }, () => [r() * 1000, r() * 600, r() < 0.12 ? 1.4 : 0.7 + r() * 0.5, 0.25 + r() * 0.55]);
})();

export function Quasar({ className = "", size = "lg" }: { className?: string; size?: string }) {
  return (
    <div className={`qz qz-${size} ${className}`} aria-hidden="true">
      <div className="qz-haze" />
      <svg className="qz-stars" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        {STARS.map(([x, y, r, o], i) => <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(2)} fill="#e9e6ff" opacity={o.toFixed(2)} />)}
      </svg>
      <div className="qz-obj">
        <svg className="qz-jets" viewBox="0 0 200 600">
          <defs>
            <linearGradient id="qzJetU" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#a5f3fc" stopOpacity=".55" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></linearGradient>
            <linearGradient id="qzJetD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c4b5fd" stopOpacity=".45" /><stop offset="1" stopColor="#8b7cff" stopOpacity="0" /></linearGradient>
          </defs>
          <path d="M100 300 L92 0 L108 0 Z" fill="url(#qzJetU)" />
          <path d="M100 300 L93 600 L107 600 Z" fill="url(#qzJetD)" />
        </svg>
        <div className="qz-halo" />
        <div className="qz-tilt">
          <div className="qz-spin">
            <svg viewBox="0 0 400 400">
              <defs>
                <linearGradient id="qzDisk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b7cff" /><stop offset=".55" stopColor="#6d4aff" /><stop offset="1" stopColor="#22d3ee" /></linearGradient>
              </defs>
              <circle cx="200" cy="200" r="190" fill="none" stroke="url(#qzDisk)" strokeWidth="3" opacity=".35" strokeDasharray="60 22 8 30" />
              <circle cx="200" cy="200" r="160" fill="none" stroke="url(#qzDisk)" strokeWidth="18" opacity=".28" />
              <circle cx="200" cy="200" r="132" fill="none" stroke="url(#qzDisk)" strokeWidth="10" opacity=".55" strokeDasharray="140 18 40 12" />
              <circle cx="200" cy="200" r="108" fill="none" stroke="#a5f3fc" strokeWidth="4" opacity=".7" strokeDasharray="90 30 20 40" />
              <circle cx="200" cy="200" r="86" fill="none" stroke="#e9e6ff" strokeWidth="2" opacity=".55" />
            </svg>
          </div>
        </div>
        <div className="qz-core" />
      </div>
    </div>
  );
}

/** Faint orbit rings: a small echo of the quasar for cards/sections. */
export function Orbits({ className = "" }: { className?: string }) {
  return (
    <svg className={`qz-orbits ${className}`} viewBox="0 0 400 400" aria-hidden="true">
      <ellipse cx="200" cy="200" rx="190" ry="62" fill="none" stroke="#8b7cff" strokeOpacity=".22" transform="rotate(-14 200 200)" />
      <ellipse cx="200" cy="200" rx="140" ry="44" fill="none" stroke="#22d3ee" strokeOpacity=".18" transform="rotate(-14 200 200)" />
      <circle cx="200" cy="200" r="5" fill="#a5f3fc" fillOpacity=".5" />
    </svg>
  );
}
