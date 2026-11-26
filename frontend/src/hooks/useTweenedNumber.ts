import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/motion";

/** Animates a number towards `value` (ease-out), so counters glide instead of jumping. */
export function useTweenedNumber(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (from === value || prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
      current.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const next = from + (value - from) * (1 - (1 - t) ** 3);
      current.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return display;
}
