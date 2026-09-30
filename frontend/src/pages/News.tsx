import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../components/ui";
import { NewsDisclaimer, NewsGrid, NewsHeader, NewsSources } from "../components/News";
import { useNews } from "../lib/news";

/** /news — every item in the Stellar news snapshot, with source filter chips. */
export default function News() {
  const news = useNews();
  const [src, setSrc] = useState<string>("all");
  useEffect(() => {
    document.title = "Stellar news · Quasaria";
  }, []);
  const withItems = news.sources.filter((s) => s.count > 0);
  const items = useMemo(() => (src === "all" ? news.items : news.items.filter((i) => i.source === src)), [news.items, src]);
  return (
    <div className="news-page">
      <PageHead kicker="News" title="Latest from Stellar" right={<NewsHeader state={news} />}>
        Headlines about Stellar, XLM and Soroban from the Stellar Development Foundation, the Stellar community and crypto news outlets. Each story opens on the publisher's site.
      </PageHead>
      <div className="row news-chips" role="group" aria-label="Filter by source">
        <button className={`chip ${src === "all" ? "on" : ""}`} aria-pressed={src === "all"} onClick={() => setSrc("all")}>All · {news.items.length}</button>
        {withItems.map((s) => (
          <button key={s.id} className={`chip ${src === s.id ? "on" : ""}`} aria-pressed={src === s.id} onClick={() => setSrc(s.id)}>{s.name} · {s.count}</button>
        ))}
      </div>
      {news.status === "loading" ? (
        <p className="muted">Loading Stellar news…</p>
      ) : news.status === "error" ? (
        <p className="muted">Stellar news is unavailable right now ({news.error}). Please try again later.</p>
      ) : (
        <NewsGrid items={items} now={news.now} empty="No stories from this source right now." />
      )}
      <p className="muted l-tiny news-foot">
        <NewsSources sources={news.sources} /> <NewsDisclaimer />
      </p>
    </div>
  );
}
