import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHead } from "../components/ui";
import { NetworkStatusLine, NewsChips, NewsDisclaimer, NewsGrid, NewsHeader, NewsSources } from "../components/News";
import { NEWS_TAGS, filterByTag, useNews, type NewsTagId } from "../lib/news";

/** /news — every item in news.json, with network status line and category filter chips (?cat=protocol). */
export default function News() {
  const news = useNews();
  const [params, setParams] = useSearchParams();
  const raw = params.get("cat");
  const tag: NewsTagId | "all" = NEWS_TAGS.some((t) => t.id === raw) ? (raw as NewsTagId) : "all";
  useEffect(() => {
    document.title = "Stellar news · Quasaria";
  }, []);
  const items = useMemo(() => filterByTag(news.items, tag), [news.items, tag]);
  return (
    <div className="news-page">
      <PageHead kicker="News" title="Latest from Stellar" right={<NewsHeader state={news} />}>
        Protocol releases, developer updates, ecosystem announcements, mainnet events and network status for Stellar, collected automatically from the Stellar Development Foundation, GitHub release notes, the Stellar status page and the Stellar community. Each story opens on the publisher's site.
      </PageHead>
      <NetworkStatusLine status={news.networkStatus} live={news.statusLive} />
      {news.status === "ready" && (
        <NewsChips items={news.items} value={tag} onChange={(v) => setParams(v === "all" ? {} : { cat: v }, { replace: true })} />
      )}
      {news.status === "loading" ? (
        <p className="muted">Loading Stellar news…</p>
      ) : news.status === "error" ? (
        <p className="muted">Stellar news is unavailable right now ({news.error}). Please try again later.</p>
      ) : (
        <NewsGrid items={items} now={news.now} empty="No stories in this category right now." />
      )}
      <p className="muted l-tiny news-foot">
        <NewsSources sources={news.sources} /> <NewsDisclaimer />
      </p>
    </div>
  );
}
