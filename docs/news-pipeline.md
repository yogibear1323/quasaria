# Stellar news pipeline

The News page (`/news`) and the "Latest from Stellar" strip on the home page update themselves.

```
GitHub Actions "Stellar news" (news.yml, cron 17 */3 * * *  + manual run)
   └─ node frontend/scripts/fetch-news-snapshot.mjs      anonymous GETs of public feeds, no secrets
        fetch → parse → plain-text sanitize → relevance + hype filters → tag → de-dupe → newest first → keep 100
   └─ commit news.json to the `news-data` branch ONLY if the content changed  ("news: update … [skip ci]")
   └─ if changed: dispatch pages.yml so the deploy bundles the fresh copy

Browser (src/lib/news.ts)
   1. raw.githubusercontent.com/<repo>/news-data/news.json    live, ~5 min cache, CORS *
   2. <site>/data/news.json                                   bundled by the Pages build (fallback)
   3. localStorage "qz.news.v2"                               this browser's last good copy
   newest valid copy wins; network status line is read live from status.stellar.org (falls back to the JSON)
```

Run it locally: `cd frontend && node scripts/fetch-news-snapshot.mjs [out.json] [--seed prev.json] [--strict]`.
The script leaves the file untouched when nothing changed, a failed source keeps its previous items, and `--strict` exits 1 only if *every* source failed.

## Sources (probed 2026-10-18)

| id | feed | tags |
|---|---|---|
| sdf | stellar.org/blog/rss.xml | from URL + keywords |
| sdf-dev | stellar.org/blog/developers/rss.xml | developers |
| stellar-core, stellar-horizon, stellar-rpc | GitHub releases.atom (pre-releases skipped) | protocol |
| soroban-sdk, js-stellar-sdk, stellar-cli | GitHub releases.atom (pre-releases skipped) | developers |
| stellar-status | status.stellar.org/history.atom (+ summary.json for the status line) | network status |
| stellar-community | medium.com/feed/stellar-community (SCF round recaps, community posts) | ecosystem |
| cointelegraph, coindesk, decrypt | outlet feeds, kept only when about Stellar / XLM / Soroban | ecosystem |

Dropped after probing: developers.stellar.org blog feed (404), stellar-protocol releases (none published), soroban-examples
(last release 2025), communityfund.stellar.org (no feed; SCF recaps arrive via the Medium feed), X/Twitter via Nitter (410 Gone,
no public RSS), r/Stellar (user posts and price chatter, blocks CI IPs).

Tags: `protocol`, `developers`, `ecosystem`, `mainnet` (mainnet events), `network-status`. An item can have several.

## Filters

* Off-topic third-party items are dropped (outlets must be about Stellar / XLM / Soroban).
* Leverage / futures promotion, "to the moon" hype and price-prediction clickbait is dropped. A hype word only in the blurb of an
  official post (SDF blog, releases, status) removes the blurb, not the post.
* Everything is reduced to plain text, links must be http(s), images https; the UI re-sanitizes whatever it reads.

## Operating notes

* GitHub pauses scheduled workflows after 60 days without repository activity; a manual run re-enables them.
* To add a source, add it to `NEWS_SOURCES` in `src/lib/newsCore.mjs` (kind `blog`, `release`, `status` or `outlet`) and check it with the script.
* To change the cadence, edit the cron in `.github/workflows/news.yml` (and the "every 3 hours" copy in `NewsDisclaimer`).
