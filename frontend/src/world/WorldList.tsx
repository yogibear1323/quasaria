import { Link } from "react-router-dom";
import { DISTRICTS, REGIONS } from "../lib/world";

/** Accessible list of every district, grouped by region. Fallback for the globe and the inner-page menu. */
export default function WorldList({ current, onNavigate, label = "Quasaria districts" }: { current?: string; onNavigate?: () => void; label?: string }) {
  return (
    <nav className="world-list" aria-label={label}>
      {REGIONS.map((r) => (
        <div key={r} className="wl-region">
          <h3>{r}</h3>
          <ul>
            {DISTRICTS.filter((d) => d.region === r).map((d) => (
              <li key={d.id}>
                <Link to={d.to} onClick={onNavigate} aria-current={current === d.id ? "page" : undefined} className={`wl-item hue-${d.hue}`}>
                  <span className="wl-dot" aria-hidden />
                  <span><b>{d.label}</b><small>{d.district} · {d.blurb}</small></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
