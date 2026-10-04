import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { PROMO_PAGE_URL, SIZZLE_WIDE_QUERY, sizzleCuts, type SizzleCut } from "../lib/sizzle";

/** true when the media query matches; defaults to `fallback` where matchMedia is unavailable (SSR/tests). */
export function useMedia(query: string, fallback: boolean) {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/**
 * Both cuts of the sizzle reel. Wide screens: widescreen + vertical side by side
 * (equal height). Narrow screens: only the vertical cut is rendered, so phones
 * never fetch the widescreen file. Click to play: no autoplay, metadata-only preload.
 */
export default function SizzleReel() {
  const wide = useMedia(SIZZLE_WIDE_QUERY, true);
  const cuts = sizzleCuts().filter((c) => wide || c.id === "vertical");
  const root = useRef<HTMLDivElement>(null);
  // only one cut plays at a time
  const onPlay = (e: SyntheticEvent<HTMLVideoElement>) => {
    root.current?.querySelectorAll("video").forEach((v) => v !== e.currentTarget && !v.paused && v.pause());
  };
  return (
    <div className="l-sizzle" ref={root} data-testid="sizzle-reel">
      <div className={`l-sizzle-grid ${wide ? "both" : "single"}`}>
        {cuts.map((c: SizzleCut) => (
          <figure key={c.id} className={`l-sizzle-cut ${c.id}`}>
            <div className="l-sizzle-frame" style={{ aspectRatio: `${c.width} / ${c.height}` }}>
              <video controls playsInline preload="metadata" poster={c.poster} width={c.width} height={c.height} onPlay={onPlay} aria-label={`Quasaria sizzle reel, ${c.label}`}>
                <source src={c.src} type="video/mp4" />
                <a href={c.src}>Download the {c.label} cut</a>
              </video>
            </div>
            <figcaption className="l-sizzle-cap">{c.label} · 0:34</figcaption>
          </figure>
        ))}
      </div>
      <a className="l-sizzle-link" href={PROMO_PAGE_URL} target="_blank" rel="noreferrer">Watch on the promo page <span aria-hidden>↗</span></a>
    </div>
  );
}
