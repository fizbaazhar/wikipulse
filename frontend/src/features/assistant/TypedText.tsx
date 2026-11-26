import { useEffect, useState } from "react";
import { useLatest } from "../../hooks/useLatest";
import { prefersReducedMotion } from "../../lib/motion";

interface Props {
  text: string;
  /** Type the text out; when false it is shown at once (e.g. an answer seen before). */
  animate: boolean;
  /** More text is still coming from the server. */
  live?: boolean;
  /** Called once all of the text is on screen. */
  onDone?: () => void;
}

/**
 * Reveals an answer at a steady typing pace, ChatGPT style. The server sends
 * text in uneven bursts (or all at once when the numbers answer); this smooths
 * them out, speeding up gently when it falls far behind.
 */
export function TypedText({ text, animate, live = false, onDone }: Props) {
  const [shown, setShown] = useState(() => (animate && !prefersReducedMotion() ? 0 : text.length));
  const done = useLatest(onDone);

  // Restarts only when new text arrives; `shown` is just where typing resumes.
  useEffect(() => {
    if (shown >= text.length) return;
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    let frame = 0;
    let carry = shown;
    const tick = () => {
      const remaining = text.length - carry;
      if (remaining <= 0) return;
      carry += Math.max(1, remaining / 60); // ~60 chars/s, a little faster when far behind
      setShown(Math.min(text.length, Math.floor(carry)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text.length]);

  useEffect(() => {
    if (!animate || shown >= text.length) done.current?.();
  }, [animate, shown, text.length, done]);

  return (
    <p dir="auto">
      {text.slice(0, shown)}
      {(live || shown < text.length) && <span className="assistant-caret" aria-hidden="true" />}
    </p>
  );
}
