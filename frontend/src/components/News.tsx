/**
 * Stellar news UI (landing "Latest from Stellar" section and the /news page).
 * All text is rendered as plain React text (never dangerouslySetInnerHTML); links are
 * http(s)-only (checked in newsCore) and open in a new tab with rel="noopener noreferrer".
 */
import { useState } from "react";
import { relativeTime, updatedLabel, type NewsItem, type NewsSourceStatus, type NewsState } from "../lib/news";

function Thumb({ src }: { src: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="news-thumb">
      <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setOk(false)} />
    </div>
  );
}

export function NewsCard({ item, now }: { item: NewsItem; now: number }) {
  return (
    <article className="card news-card">
      <a className="news-link" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} (${item.sourceName}, opens in a new tab)`}>
        {item.image && <Thumb src={item.image} />}
        <div className="news-body">
          <div className="news-meta">
            <span className="news-src">{item.sourceName}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>{relativeTime(item.publishedAt, now)}</time>
          </div>
          <h3 className="news-title">{item.title}</h3>
          {item.excerpt && <p className="news-excerpt">{item.excerpt}</p>}
          <span className="news-out">Read on {hostOf(item.url)} ↗</span>
        </div>
      </a>
    </article>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

export function NewsHeader({ state }: { state: NewsState }) {
  return (
    <div className="news-head">
      <span className="l-label preview" data-testid="news-label">Stellar news</span>
      <span className="muted l-tiny" data-testid="news-updated">
        Updated {updatedLabel(state.updatedAt)}
        {state.mode === "live" ? " · live" : state.mode === "snapshot" ? " · refreshed about every 30 min" : ""}
      </span>
    </div>
  );
}

export function NewsSources({ sources }: { sources: NewsSourceStatus[] }) {
  if (!sources.length) return null;
  return (
    <span data-testid="news-sources">
      Sources:{" "}
      {sources.map((s, i) => (
        <span key={s.id}>
          {i > 0 && ", "}
          {s.home ? <a href={s.home} target="_blank" rel="noopener noreferrer">{s.name}</a> : s.name}
          {s.count === 0 ? <span className="muted"> (no Stellar stories right now)</span> : null}
        </span>
      ))}
      .
    </span>
  );
}

export function NewsDisclaimer() {
  return (
    <span data-testid="news-disclaimer">
      Headlines and short excerpts come from third-party sources and link to the original articles. Their inclusion is not an endorsement by Quasaria and nothing here is financial advice.
    </span>
  );
}

export function NewsGrid({ items, now, empty }: { items: NewsItem[]; now: number; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="news-grid" data-testid="news-grid">
      {items.map((it) => <NewsCard key={it.id} item={it} now={now} />)}
    </div>
  );
}
