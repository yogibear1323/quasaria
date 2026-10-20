const BASE = import.meta.env.BASE_URL ?? "/";

/** Video in a frost card: click-to-play (no autoplay), captions burned in. `collapsible` keeps it compact. */
export default function ExplainerVideo({ name, title, testid, collapsible = false, style, src, poster, preload = "metadata", note = "About 1½ minutes · captions are part of the video.", heading = "h2" }: {
  name?: string; title: string; testid: string; collapsible?: boolean; style?: React.CSSProperties; src?: string; poster?: string; preload?: "metadata" | "none"; note?: string | null; heading?: "h2" | "h3";
}) {
  const s = src ?? `${BASE}videos/${name}.mp4`;
  const video = (
    <video controls preload={preload} playsInline poster={poster ?? `${BASE}videos/${name}-poster.jpg`} style={{ width: "100%", borderRadius: 10, display: "block", background: "#0b1428" }} aria-label={title}>
      <source src={s} type="video/mp4" />
    </video>
  );
  const H = heading;
  return collapsible ? (
    <details className="card" style={style} data-testid={testid}>
      <summary style={{ cursor: "pointer" }}><b>▶ {title}</b> <span className="muted l-tiny">· about 1½ min, captions on</span></summary>
      <div style={{ marginTop: 12, maxWidth: 860 }}>{video}</div>
    </details>
  ) : (
    <div className="card" style={style} data-testid={testid}>
      <H style={{ marginTop: 0 }}>{title}</H>
      {video}
      {note && <p className="muted l-tiny" style={{ marginBottom: 0 }}>{note}</p>}
    </div>
  );
}
