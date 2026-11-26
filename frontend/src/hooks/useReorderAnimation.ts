import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/motion";

/**
 * FLIP animation for a list whose items change order: each child with a
 * `data-key` that moved slides from its old position to the new one.
 */
export function useReorderAnimation<T extends HTMLElement>(durationMs = 450) {
  const ref = useRef<T | null>(null);
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const animate = !prefersReducedMotion();
    const next = new Map<string, number>();
    for (const child of Array.from(list.children) as HTMLElement[]) {
      const key = child.dataset.key;
      if (!key) continue;
      const top = child.offsetTop;
      next.set(key, top);
      const previous = positions.current.get(key);
      if (animate && previous !== undefined && previous !== top && typeof child.animate === "function") {
        child.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], {
          duration: durationMs,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    }
    positions.current = next;
  });

  return ref;
}
