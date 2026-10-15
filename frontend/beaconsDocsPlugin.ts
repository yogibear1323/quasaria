// Build-time markdown → structured HTML for the /beacons "full documents" section.
// `import doc from "./x.md?beacons-doc"` yields { title, intro, sections: [{ id, title, html, subs: [{ id, title, html }] }], headings }.
// h1 = doc title, each h2 = a dropdown, each h3 = a nested dropdown; h4+ stay inside their parent's HTML.
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { Marked, type Token, type Tokens } from "marked";

const REPO = "https://github.com/yogibear1323/quasaria-beacons/blob/main/";
const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[`*_~]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function beaconsDocs(): Plugin {
  return {
    name: "beacons-docs",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(".md?beacons-doc")) return null;
      const file = id.slice(0, -"?beacons-doc".length);
      const src = readFileSync(file, "utf8");
      const name = file.split("/").pop()!;
      const docPath = name === "README.md" ? "README.md" : `docs/${name}`;
      const pre = name.replace(/\.md$/, "").toLowerCase();
      const marked = new Marked({ gfm: true });
      marked.use({ renderer: {
        link({ href, title, tokens }: Tokens.Link) {
          const text = this.parser.parseInline(tokens);
          let h = href;
          if (!/^(https?:|mailto:|#)/.test(h)) h = new URL(h, REPO + docPath).href;
          const ext = /^https?:/.test(h) ? ' target="_blank" rel="noreferrer"' : "";
          return `<a href="${h}"${title ? ` title="${title}"` : ""}${ext}>${text}</a>`;
        },
      } });
      const tokens = marked.lexer(src);
      const render = (t: Token[]) => (marked.parser(t) as string).replace(/<table>/g, '<div class="md-table"><table>').replace(/<\/table>/g, "</table></div>");
      let title = name; const intro: Token[] = [];
      type Sub = { id: string; title: string; toks: Token[] };
      type Sec = Sub & { subs: Sub[] };
      const sections: Sec[] = []; let headings = 0;
      for (const t of tokens) {
        if (t.type === "heading" && t.depth <= 3) {
          headings++;
          const text = marked.parseInline((t as Tokens.Heading).text) as string;
          if (t.depth === 1 && !sections.length && title === name) { title = text; continue; }
          if (t.depth <= 2 || !sections.length) { sections.push({ id: `${pre}-${slug(text)}`, title: text, toks: [], subs: [] }); continue; }
          const s = sections[sections.length - 1]; s.subs.push({ id: `${s.id}--${slug(text)}`, title: text, toks: [] }); continue;
        }
        if (t.type === "heading") headings++;
        const s = sections[sections.length - 1];
        if (!s) intro.push(t); else if (s.subs.length) s.subs[s.subs.length - 1].toks.push(t); else s.toks.push(t);
      }
      const out = { title, path: docPath, url: REPO + docPath, headings, intro: render(intro),
        sections: sections.map((s) => ({ id: s.id, title: s.title, html: render(s.toks), subs: s.subs.map((u) => ({ id: u.id, title: u.title, html: render(u.toks) })) })) };
      this.addWatchFile(file);
      return `export default ${JSON.stringify(out)};`;
    },
  };
}
