import { useLayoutEffect, useRef } from "react";

// Colours are CSS custom properties (styles/tokens.css), so light/dark switch in one place.
export const SERIES = {
  human: "var(--series-1)",
  bot: "var(--series-2)",
  anonymous: "var(--series-3)",
  other: "var(--series-other)",
  added: "var(--diverge-pos)",
  removed: "var(--diverge-neg)",
  unchanged: "var(--diverge-mid)",
} as const;

/** Five validated slots for wikis (brand palette plus amber and teal; validated per theme). */
export const WIKI_SLOTS = ["var(--wiki-1)", "var(--wiki-2)", "var(--wiki-3)", "var(--wiki-4)", "var(--wiki-5)"];

/**
 * Colour follows the entity, never its rank: a wiki keeps its slot while it
 * stays in the chart, even when the ranking reshuffles. A newcomer takes the
 * lowest free slot.
 */
export function useStableSlots(keys: string[], slotCount = WIKI_SLOTS.length): Map<string, number> {
  const assigned = useRef(new Map<string, number>());
  const current = new Map<string, number>();
  const used = new Set<number>();
  for (const key of keys) {
    const slot = assigned.current.get(key);
    if (slot !== undefined && !used.has(slot)) {
      current.set(key, slot);
      used.add(slot);
    }
  }
  for (const key of keys) {
    if (current.has(key)) continue;
    let slot = 0;
    while (used.has(slot) && slot < slotCount) slot++;
    current.set(key, slot % slotCount);
    used.add(slot);
  }
  // Remember the assignment once the render commits (renders may be discarded).
  useLayoutEffect(() => {
    assigned.current = current;
  });
  return current;
}
