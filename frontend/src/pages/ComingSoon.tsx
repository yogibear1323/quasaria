import { IS_MAINNET } from "../lib/config";
import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";

/** An honest placeholder for a destination that is not built yet: no data, no forms that look functional. */
export default function ComingSoon({ kicker, title, children, links = [] }: { kicker: string; title: string; children: React.ReactNode; links?: { to: string; label: string }[] }) {
  return (
    <>
      <PageHead kicker={kicker} title={title} right={<span className="pill gold" data-testid="coming-soon-pill">Coming soon</span>}>{children}</PageHead>
      <div className="card glow" data-testid="coming-soon" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>Coming soon</h2>
        <p className="muted">This page is not live yet. There is nothing to trade or sign here, and no numbers are shown until it is built. {IS_MAINNET ? "Quasaria runs on Stellar mainnet." : "Quasaria is a testnet beta."}</p>
        {links.length > 0 && <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{links.map((l) => <Link key={l.to} className="btn small ghost" to={l.to}>{l.label}</Link>)}</div>}
      </div>
    </>
  );
}
