import { SIZZLE_WIDE_QUERY } from "../lib/sizzle";
import { FEATURE_VIDEOS, FEATURE_VIDEOS_COPY, featurePoster, featureSrc, fmtRuntime } from "../lib/featureVideos";
import { useMedia } from "./SizzleReel";
import ExplainerVideo from "./ExplainerVideo";

/**
 * Feature tour videos, each in the same frost card + inline player as the Holders / Markets explainers.
 * preload="none": only the small posters load until a video is played. 9:16 cut on narrow screens.
 */
export default function FeatureVideos() {
  const wide = useMedia(SIZZLE_WIDE_QUERY, true);
  const aspect = wide ? "16x9" : "9x16";
  return (
    <div className="l-fv" data-testid="feature-videos">
      <div className="grid g-3" style={{ gap: 16 }}>
        {FEATURE_VIDEOS.map((v) => (
          <ExplainerVideo key={`${v.id}-${aspect}`} testid="feature-video-card" heading="h3" title={v.title} src={featureSrc(v, aspect)} poster={featurePoster(v, aspect)} preload="none"
            note={`${fmtRuntime(v.seconds)}${v.tag && !v.tag.startsWith("In development") ? ` · ${v.tag}` : ""}`} />
        ))}
      </div>
      <p className="l-fv-note">{FEATURE_VIDEOS_COPY.note}</p>
    </div>
  );
}
