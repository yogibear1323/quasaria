import { useEffect, useRef, useState } from "react";

/** Copy-to-clipboard button with an explicit "Copied" confirmation (announced to screen readers). */
export function CopyButton({ value, label = "Copy", what = "address", small = true, ghost = true }: { value: string; label?: string; what?: string; small?: boolean; ghost?: boolean }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setState("ok"); } catch { setState("fail"); }
    clearTimeout(t.current);
    t.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <span className="copyrow">
      <button type="button" className={`btn${small ? " small" : ""}${ghost ? " ghost" : ""}`} onClick={copy} data-testid="copy-btn" aria-label={`Copy ${what}`}>
        {state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{state === "ok" ? `${what} copied to clipboard` : state === "fail" ? "Copy was blocked by the browser. Select the text and copy it manually." : ""}</span>
    </span>
  );
}
