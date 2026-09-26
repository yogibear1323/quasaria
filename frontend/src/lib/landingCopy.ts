/**
 * The landing page copy lives in docs/landing-outline.md (approved copy).
 * We parse it at build time instead of retyping it, so headlines and pitches
 * on the page are exactly the approved text.
 */
export type OutlineSection = { n: number; title: string; headline: string; pitch: string; visual: string };

export function parseOutline(md: string): OutlineSection[] {
  const out: OutlineSection[] = [];
  let cur: OutlineSection | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^(\d+)\.\s+(.+)$/.exec(line);
    if (h) {
      cur = { n: Number(h[1]), title: h[2], headline: "", pitch: "", visual: "" };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const f = /^(Headline|Pitch|Visual):\s*(.*)$/.exec(line);
    if (f) cur[f[1].toLowerCase() as "headline" | "pitch" | "visual"] = f[2];
  }
  return out;
}
