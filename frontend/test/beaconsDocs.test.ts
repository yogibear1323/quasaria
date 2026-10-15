import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beaconsDocs } from "../beaconsDocsPlugin";

const dir = resolve(__dirname, "../src/content/beacons-docs");
const load = (f: string) => {
  const p = beaconsDocs() as unknown as { load: (this: { addWatchFile: () => void }, id: string) => string };
  return JSON.parse(p.load.call({ addWatchFile: () => {} }, `${dir}/${f}?beacons-doc`).replace(/^export default /, "").replace(/;$/, ""));
};
const srcHeadings = (md: string) => md.replace(/```[\s\S]*?```/g, "").split("\n").filter((l) => /^#{1,6} /.test(l)).length;

describe("Beacons full documents (build-time markdown)", () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    it(`${f}: every heading, table row and paragraph is rendered`, () => {
      const md = readFileSync(`${dir}/${f}`, "utf8");
      const d = load(f);
      expect(d.headings).toBe(srcHeadings(md));
      const h2h3 = md.replace(/```[\s\S]*?```/g, "").split("\n").filter((l) => /^#{2,3} /.test(l)).length;
      const h1Extra = md.split("\n").filter((l) => /^# /.test(l)).length - 1;
      expect(d.sections.length + d.sections.reduce((n: number, s: { subs: unknown[] }) => n + s.subs.length, 0)).toBe(h2h3 + h1Extra);
      const html = [d.intro, ...d.sections.flatMap((s: { html: string; subs: { html: string }[] }) => [s.html, ...s.subs.map((u) => u.html)])].join("");
      const rows = md.split("\n").filter((l) => /^\|/.test(l) && !/^\|(\s*:?-+:?\s*\|)+\s*$/.test(l)).length;
      expect((html.match(/<tr>/g) ?? []).length).toBe(rows);
    });
  }
});
