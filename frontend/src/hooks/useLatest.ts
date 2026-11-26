import { useLayoutEffect, useRef } from "react";

/**
 * A ref that always holds the latest `value`, for callbacks (timers, socket
 * handlers, async code) that must see the newest props or state without
 * re-running the effect that created them.
 *
 * The ref is updated in a layout effect rather than during render: a render
 * can be thrown away, a commit can't. Layout effects run before regular
 * effects and before the browser handles the next event, so readers never
 * see a stale value.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
