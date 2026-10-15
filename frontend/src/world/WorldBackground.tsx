/** Page scene key (kept for per-page tint hooks on the world background). */
export type Scene = "quasar" | "nebula" | "orbits" | "supernova" | "constellation" | "warp";

/** Frost backdrop: stormy starry sky, layered snowy mountain range, gentle falling snow and frost Stellar coins. Pure CSS; static under reduced motion. */
export default function WorldBackground({ scene = "quasar" }: { scene?: Scene }) {
  return (
    <div className={`world-bg scene-${scene}`} aria-hidden>
      <div className="wb-bands"><i /><i /><i /></div>
      <div className="wb-horizon" />
      <div className="wb-floor"><div className="wb-grid" /></div>
      <div className="wb-sky-grid" />
      <div className="wb-sky" />
      <div className="wb-stars" />
      <div className="wb-mtn" />
      <div className="wb-yeti" />
      <div className="wb-snow"><i /><i /><i /></div>
      <div className="wb-coins"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
    </div>
  );
}
