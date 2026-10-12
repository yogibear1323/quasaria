/** Light "dimension" backdrop: pearl base, slow shifting light bands and a perspective neon grid floor. Pure CSS; static under reduced motion. */
export default function WorldBackground({ scene = "default" }: { scene?: string }) {
  return (
    <div className={`world-bg scene-${scene}`} aria-hidden>
      <div className="wb-bands"><i /><i /><i /></div>
      <div className="wb-horizon" />
      <div className="wb-floor"><div className="wb-grid" /></div>
      <div className="wb-sky-grid" />
    </div>
  );
}
