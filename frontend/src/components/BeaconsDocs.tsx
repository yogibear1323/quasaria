/** Full Beacons documents (yogibear1323/quasaria-beacons), rendered from the bundled markdown at build time.
 *  One <details> per document, a table of contents, and nested <details> per h2 / h3. Preview · not deployed. */
import type { MouseEvent } from "react";
import readme from "../content/beacons-docs/README.md?beacons-doc";
import concept from "../content/beacons-docs/concept.md?beacons-doc";
import scope from "../content/beacons-docs/deployment-scope.md?beacons-doc";
import plan from "../content/beacons-docs/dex-integration-plan.md?beacons-doc";
import theme from "../content/beacons-docs/backoffice-theme.md?beacons-doc";

const DOCS = [
  { key: "overview", label: "Overview (README)", doc: readme },
  { key: "concept", label: "Concept write-up", doc: concept },
  { key: "plan", label: "DEX integration plan", doc: plan },
  { key: "scope", label: "Deployment scope", doc: scope },
  { key: "theme", label: "Back Office theme notes", doc: theme },
];
export const BEACONS_DOCS = DOCS;

/** TOC jump: open the target <details> and every ancestor, then scroll to it. */
function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n instanceof HTMLDetailsElement) n.open = true;
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

const H = ({ html }: { html: string }) => <span dangerouslySetInnerHTML={{ __html: html }} />;

export default function BeaconsDocs() {
  return (
    <section className="bp-sec bd" aria-labelledby="bd-h" id="beacons-docs">
      <h2 id="bd-h">Full Beacons documents</h2>
      <p className="muted">The complete write-ups from <a href="https://github.com/yogibear1323/quasaria-beacons" target="_blank" rel="noreferrer">quasaria-beacons</a>, word for word. <b>Preview · not deployed · illustrative</b>; not a guaranteed return.</p>
      {DOCS.map(({ key, label, doc }) => (
        <details key={key} className="bd-doc card" id={`doc-${key}`}>
          <summary><span className="bd-doc-t"><small>{label}</small><H html={doc.title} /></span><span className="pill gold">Preview · not deployed</span><span className="bd-chev" aria-hidden="true">▾</span></summary>
          <div className="bd-body">
            <nav className="bd-toc" aria-label={`Contents: ${label}`}><b>Contents</b>
              <ol>{doc.sections.map((s) => (
                <li key={s.id}><a href={`#${s.id}`} onClick={(e) => jump(e, s.id)}><H html={s.title} /></a>
                  {s.subs.length > 0 && <ol>{s.subs.map((u) => <li key={u.id}><a href={`#${u.id}`} onClick={(e) => jump(e, u.id)}><H html={u.title} /></a></li>)}</ol>}</li>))}</ol>
              <a className="bd-src" href={doc.url} target="_blank" rel="noreferrer">Source: {doc.path} ↗</a>
            </nav>
            {doc.intro && <div className="md" dangerouslySetInnerHTML={{ __html: doc.intro }} />}
            {doc.sections.map((s) => (
              <details key={s.id} id={s.id} className="bd-sec" data-level="2">
                <summary><H html={s.title} /></summary>
                <div className="md" dangerouslySetInnerHTML={{ __html: s.html }} />
                {s.subs.map((u) => (
                  <details key={u.id} id={u.id} className="bd-sub" data-level="3">
                    <summary><H html={u.title} /></summary>
                    <div className="md" dangerouslySetInnerHTML={{ __html: u.html }} />
                  </details>))}
              </details>))}
          </div>
        </details>))}
    </section>
  );
}
