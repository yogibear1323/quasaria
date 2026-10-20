const BASE = import.meta.env.BASE_URL ?? "/";

/** Explainer video in a frost card: click-to-play (no autoplay), captions burned in. `collapsible` keeps it compact. */
export default function ExplainerVideo({ name, title, testid, collapsible = false, style }: { name: string; title: string; testid: string; collapsible?: boolean; style?: React.CSSProperties }) {
  const video = (
    <video controls preload="metadata" playsInline poster={`${BASE}videos/${name}-poster.jpg`} style={{ width: "100%", borderRadius: 10, display: "block", background: "#0b1428" }} aria-label={title}>
      <source src={`${BASE}videos/${name}.mp4`} type="video/mp4" />
    </video>
  );
  return collapsible ? (
    <details className="card" style={style} data-testid={testid}>
      <summary style={{ cursor: "pointer" }}><b>▶ {title}</b> <span className="muted l-tiny">· about 1½ min, captions on</span></summary>
      <div style={{ marginTop: 12, maxWidth: 860 }}>{video}</div>
    </details>
  ) : (
    <div className="card" style={style} data-testid={testid}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {video}
      <p className="muted l-tiny" style={{ marginBottom: 0 }}>About 1½ minutes · captions are part of the video.</p>
    </div>
  );
}
