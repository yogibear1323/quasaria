/**
 * Stellar news UI: the landing "Latest from Stellar" strip (NewsStrip) and the /news page parts.
 * All text is rendered as plain React text (never dangerouslySetInnerHTML); links are http(s)-only
 * (checked in newsCore) and open in a new tab with rel="noopener noreferrer". Times are shown in the viewer's local zone.
 */
import { useState } from "react";
import "../theme/news.css";
import { Link } from "react-router-dom";
import { NEWS_TAGS, filterByTag, itemTime, localTime, pickStrip, relativeTime, tagCounts, useNews, type NetworkStatus, type NewsItem, type NewsSourceInfo, type NewsState, type NewsTagId } from "../lib/news";

const tagLabel = (id: NewsTagId) => NEWS_TAGS.find((t) => t.id === id)?.label ?? id;

function Thumb({ src }: { src: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="news-thumb">
      <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setOk(false)} />
    </div>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

export function NewsCard({ item, now }: { item: NewsItem; now: number }) {
  return (
    <article className="card news-card" data-testid="news-item" data-tags={item.tags.join(" ")}>
      <a className="news-link" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} (${item.sourceName}, opens in a new tab)`}>
        {item.image && <Thumb src={item.image} />}
        <div className="news-body">
          <div className="news-meta">
            <span className="news-src">{item.sourceName}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.publishedAt} title={`${localTime(item.publishedAt, true)} (${relativeTime(item.publishedAt, now)})`}>{itemTime(item.publishedAt, now)}</time>
          </div>
          <h3 className="news-title">{item.title}</h3>
          {item.excerpt && <p className="news-excerpt">{item.excerpt}</p>}
          <div className="news-foot-row">
            <span className="news-tags">
              {item.tags.slice(0, 3).map((t) => <span key={t} className={`news-tag t-${t}`}>{tagLabel(t)}</span>)}
            </span>
            <span className="news-out">{hostOf(item.url)} ↗</span>
          </div>
        </div>
      </a>
    </article>
  );
}

export function NewsHeader({ state }: { state: NewsState }) {
  return (
    <div className="news-head">
      <span className="l-label preview" data-testid="news-label">Stellar news</span>
      <span className="muted l-tiny" data-testid="news-updated">
        Updated <time dateTime={state.updatedAt ?? undefined}>{localTime(state.updatedAt, true)}</time>
        {state.origin === "cached" ? " · offline copy" : ""}
      </span>
    </div>
  );
}

const STATUS_CLASS: Record<NetworkStatus["indicator"], string> = { none: "ok", maintenance: "warn", minor: "warn", major: "bad", critical: "bad" };

/** "● Stellar network: All Systems Operational" — live from status.stellar.org, or from the JSON when that fails. */
export function NetworkStatusLine({ status, live }: { status: NetworkStatus | null; live: boolean }) {
  if (!status) return null;
  const extra = status.issues.length ? status.issues.join("; ") : status.degraded.length ? `Affected: ${status.degraded.join(", ")}` : "";
  return (
    <p className={`news-status s-${STATUS_CLASS[status.indicator]}`} data-testid="network-status" role="status">
      <span className="news-status-dot" aria-hidden />
      <span>
        <strong>Stellar network:</strong> {status.description}
        {extra ? ` — ${extra}` : ""}
      </span>
      <a href={status.url} target="_blank" rel="noopener noreferrer" className="news-status-link">
        status.stellar.org ↗
      </a>
      <span className="muted l-tiny">{live ? "checked just now" : `as of ${localTime(status.updatedAt)}`}</span>
    </p>
  );
}

export function NewsChips({ items, value, onChange }: { items: NewsItem[]; value: NewsTagId | "all"; onChange: (v: NewsTagId | "all") => void }) {
  const counts = tagCounts(items);
  return (
    <div className="row news-chips" role="group" aria-label="Filter by category" data-testid="news-chips">
      <button className={`chip ${value === "all" ? "on" : ""}`} aria-pressed={value === "all"} onClick={() => onChange("all")}>All · {items.length}</button>
      {counts.map((c) => (
        <button key={c.id} className={`chip ${value === c.id ? "on" : ""}`} aria-pressed={value === c.id} data-tag={c.id} onClick={() => onChange(c.id)}>{c.label} · {c.count}</button>
      ))}
    </div>
  );
}

export function NewsSources({ sources }: { sources: NewsSourceInfo[] }) {
  const used = sources.filter((s) => s.count > 0);
  if (!used.length) return null;
  return (
    <span data-testid="news-sources">
      Sources:{" "}
      {used.map((s, i) => (
        <span key={s.id}>
          {i > 0 && ", "}
          {s.home ? <a href={s.home} target="_blank" rel="noopener noreferrer">{s.name}</a> : s.name}
        </span>
      ))}
      .
    </span>
  );
}

export function NewsDisclaimer() {
  return (
    <span data-testid="news-disclaimer">
      Collected automatically from public feeds every 3 hours; headlines and short excerpts link to the original publishers. Inclusion is not an endorsement by Quasaria and nothing here is financial advice.
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

/** Landing page strip: network status line, category chips, the 6 newest matching stories. */
export function NewsStrip() {
  const news = useNews();
  const [tag, setTag] = useState<NewsTagId | "all">("all");
  const shown = pickStrip(filterByTag(news.items, tag), 6, tag === "all" ? 2 : 6);
  return (
    <div>
      <div className="row between l-wrap" style={{ marginBottom: 14 }}>
        <NewsHeader state={news} />
        <Link to="/news" className="btn ghost small">See all news →</Link>
      </div>
      <NetworkStatusLine status={news.networkStatus} live={news.statusLive} />
      {news.status === "loading" ? (
        <p className="muted">Loading Stellar news…</p>
      ) : news.status === "error" ? (
        <p className="muted">Stellar news is unavailable right now. <Link to="/news">Try the news page →</Link></p>
      ) : (
        <>
          <NewsChips items={news.items} value={tag} onChange={setTag} />
          <NewsGrid items={shown} now={news.now} empty="No Stellar stories in this category right now." />
        </>
      )}
      <p className="muted l-tiny news-foot">
        <NewsSources sources={news.sources} /> <NewsDisclaimer /> <Link to="/news">See all news →</Link>
      </p>
    </div>
  );
}
