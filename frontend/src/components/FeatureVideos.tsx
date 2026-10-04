import { useEffect, useRef, useState } from "react";
import { SIZZLE_WIDE_QUERY } from "../lib/sizzle";
import { FEATURE_VIDEOS, FEATURE_VIDEOS_COPY, featurePoster, featureSrc, fmtRuntime, type FeatureVideo } from "../lib/featureVideos";
import { useMedia } from "./SizzleReel";

/**
 * Poster grid of the feature tour videos. Nothing is fetched but the small
 * posters (lazy) until a card is clicked; the player opens in a modal with
 * preload="none" and picks the 9:16 cut on narrow screens.
 */
export default function FeatureVideos() {
  const wide = useMedia(SIZZLE_WIDE_QUERY, true);
  const [open, setOpen] = useState<FeatureVideo | null>(null);
  const aspect = wide ? "16x9" : "9x16";
  return (
    <div className="l-fv" data-testid="feature-videos">
      <ul className="l-fv-grid">
        {FEATURE_VIDEOS.map((v) => (
          <li key={v.id}>
            <button type="button" className="l-fv-card" onClick={() => setOpen(v)} aria-label={`Play ${v.title} video, ${fmtRuntime(v.seconds)}`}>
              <span className="l-fv-thumb">
                <picture>
                  <source media="(max-width: 720px)" srcSet={featurePoster(v, "9x16")} />
                  <img src={featurePoster(v, "16x9")} alt="" loading="lazy" decoding="async" width={640} height={360} />
                </picture>
                <span className="l-fv-play" aria-hidden>▶</span>
                <span className="l-fv-time">{fmtRuntime(v.seconds)}</span>
              </span>
              <span className="l-fv-title">{v.title}</span>
              {v.tag ? <span className={`l-fv-tag ${v.tag.startsWith("In development") ? "dev" : v.tag.startsWith("Live") ? "live" : "risk"}`}>{v.tag}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="l-fv-note">{FEATURE_VIDEOS_COPY.note}</p>
      {open ? <Player v={open} aspect={aspect} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Player({ v, aspect, onClose }: { v: FeatureVideo; aspect: "16x9" | "9x16"; onClose: () => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    vid.current?.play().catch(() => undefined); // opened by a click, so play is allowed; ignore if blocked
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v, onClose]);
  return (
    <div className="l-fv-modal" role="dialog" aria-modal="true" aria-label={`${v.title} video`} onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="feature-video-modal">
      <div className={`l-fv-box a${aspect}`}>
        <div className="l-fv-head">
          <span className="l-fv-title">{v.title} · {fmtRuntime(v.seconds)}</span>
          <button type="button" ref={close} className="l-fv-close" onClick={onClose} aria-label="Close video">✕</button>
        </div>
        <video key={`${v.id}-${aspect}`} ref={vid} controls playsInline preload="none" poster={featurePoster(v, aspect)} width={aspect === "16x9" ? 1280 : 720} height={aspect === "16x9" ? 720 : 1280}>
          <source src={featureSrc(v, aspect)} type="video/mp4" />
          <a href={featureSrc(v, aspect)}>Download the {v.title} video</a>
        </video>
      </div>
    </div>
  );
}
