import { useCallback, useEffect, useState } from "react";

const DONE_KEY = "wikipulse-tour-done-v1";

/** Opens the tour on a user's first visit and lets them replay it. */
export function useTour() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(DONE_KEY) === "1";
    } catch {
      /* storage blocked: don't auto-open */
    }
    if (seen) return;
    // Give the first data a moment to lay out the board.
    const timer = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(timer);
  }, []);
  const start = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(DONE_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);
  return { open, start, close };
}
