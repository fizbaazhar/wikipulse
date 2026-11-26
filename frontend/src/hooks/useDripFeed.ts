import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_FEED } from "../state/dashboard";
import type { Edit } from "../types";

interface Options {
  /** Change this to replace the list at once instead of trickling (new filter, reconnect). */
  resetKey?: unknown;
  /** Stop releasing new edits (e.g. while the pointer is over the feed). */
  hold?: boolean;
  max?: number;
  /** How often queued edits are released. */
  intervalMs?: number;
  /** Target time to release one server batch; batches arrive once a second. */
  drainMs?: number;
}

/**
 * Turns "one batch of ~40 edits per second" into a steady trickle.
 *
 * The server pushes edits in per-second batches (efficient), but inserting
 * 40 rows at once makes the list jump. New edits are queued and released a
 * few at a time so a batch is spread across the second. Flag updates to
 * edits already on screen apply immediately. When `resetKey` changes (first
 * load, wiki filter changed, reconnect) the new list is shown at once.
 */
export function useDripFeed(
  edits: Edit[],
  { resetKey, hold = false, max = MAX_FEED, intervalMs = 60, drainMs = 900 }: Options = {},
) {
  const [shown, setShown] = useState<Edit[]>(edits);
  const [queued, setQueued] = useState(0);
  const shownRef = useRef<Edit[]>(edits);
  const queue = useRef<Edit[]>([]); // oldest first
  const lastResetKey = useRef(resetKey);

  const publish = useCallback((next: Edit[]) => {
    shownRef.current = next;
    setShown(next);
    setQueued(queue.current.length);
  }, []);

  // Incoming list changed: queue new edits, refresh ones already visible.
  useEffect(() => {
    const latest = new Map(edits.map((e) => [e.id, e]));
    const current = shownRef.current;

    if (resetKey !== lastResetKey.current || current.length === 0) {
      lastResetKey.current = resetKey;
      queue.current = [];
      publish(edits.slice(0, max));
      return;
    }

    const known = new Set(current.map((e) => e.id));
    for (const e of queue.current) known.add(e.id);
    const fresh: Edit[] = [];
    for (let i = edits.length - 1; i >= 0; i--) {
      if (!known.has(edits[i].id)) fresh.push(edits[i]); // oldest first
    }
    queue.current = [...queue.current.map((e) => latest.get(e.id) ?? e), ...fresh].slice(-max);

    let changed = false;
    const refreshed = current.map((e) => {
      const update = latest.get(e.id);
      if (update && update !== e) {
        changed = true;
        return update;
      }
      return e;
    });
    if (changed) publish(refreshed);
    else setQueued(queue.current.length);
  }, [edits, resetKey, max, publish]);

  // Release a few queued edits per interval, sized to drain one batch in ~drainMs.
  useEffect(() => {
    if (hold) return;
    const ticksPerDrain = Math.max(1, Math.round(drainMs / intervalMs));
    const id = setInterval(() => {
      if (queue.current.length === 0) return;
      const count = Math.max(1, Math.ceil(queue.current.length / ticksPerDrain));
      const batch = queue.current.splice(0, count);
      publish([...batch.reverse(), ...shownRef.current].slice(0, max));
    }, intervalMs);
    return () => clearInterval(id);
  }, [hold, intervalMs, drainMs, max, publish]);

  /** Show everything that is queued right now. */
  const flush = useCallback(() => {
    const batch = queue.current.splice(0);
    if (batch.length) publish([...batch.reverse(), ...shownRef.current].slice(0, max));
  }, [max, publish]);

  return { shown, queued, flush };
}
