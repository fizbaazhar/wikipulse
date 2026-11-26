import { memo, useState } from "react";
import { useDripFeed } from "../hooks/useDripFeed";
import { useNow } from "../hooks/useNow";
import { formatClock, formatDelta, safeUrl, wikiLabel } from "../lib/format";
import type { Edit } from "../types";
import { FlagBadge } from "./FlagBadge";

interface Props {
  edits: Edit[];
  /** Changes when the server replaced the feed; the list then updates at once. */
  feedVersion?: number;
  paused: boolean;
  pendingCount: number;
  onTogglePause: () => void;
  /** While paused: show what has arrived now instead of at the next update. */
  onRefresh?: () => void;
  /** While paused: when the feed next catches up on its own (ms since epoch). */
  nextUpdate?: number | null;
}

/**
 * Live feed of recent edits, newest first.
 *
 * - It starts paused and catches up every two minutes, so the list stays
 *   readable; "Go live" makes it follow the stream, "Pause" stops it again.
 * - New edits trickle in one by one (see `useDripFeed`) instead of jumping in
 *   per-second batches.
 * - Hovering (mouse or pen) or focusing the feed holds it still so a row can be read or
 *   clicked; a counter shows how many edits are waiting.
 * - Every piece of edit data is rendered as React text, never as HTML, so an
 *   edit summary like `<script>…</script>` shows up as harmless text.
 */
export function LiveFeed({ edits, feedVersion, paused, pendingCount, onTogglePause, onRefresh, nextUpdate }: Props) {
  const [reading, setReading] = useState(false);
  const { shown, queued, flush } = useDripFeed(edits, { hold: reading || paused, resetKey: feedVersion });
  const waiting = queued + pendingCount;

  return (
    // Hover/focus is tracked on the card, which never unmounts, so the hold
    // cannot get stuck if the list itself disappears (e.g. a quiet wiki).
    <section
      className="card feed"
      aria-labelledby="feed-title"
      // Touch has no hover: a tap sends "enter" but never "leave", which
      // would hold the feed for good. Touch users have the Pause button.
      onPointerEnter={(e) => e.pointerType !== "touch" && setReading(true)}
      onPointerLeave={(e) => e.pointerType !== "touch" && setReading(false)}
      onFocus={() => setReading(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setReading(false);
      }}
    >
      <div className="card-head">
        <h2 id="feed-title">Live feed</h2>
        <div className="feed-controls">
          {paused && nextUpdate != null && <NextUpdate at={nextUpdate} />}
          {(reading || paused) && waiting > 0 && (
            <button
              type="button"
              className="chip chip-waiting"
              onClick={paused ? (onRefresh ?? onTogglePause) : flush}
              title={paused ? "Show them now" : undefined}
            >
              {waiting} new
            </button>
          )}
          {reading && !paused && <span className="muted small">Held while you read</span>}
          <button type="button" className={paused ? "btn-ghost btn-live" : "btn-ghost"} onClick={onTogglePause}>
            {paused ? "Go live" : "Pause"}
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted">Waiting for edits…</p>
      ) : (
        <ul className="feed-list" aria-live="off">
          {shown.map((e) => (
            <FeedItem key={e.id} edit={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Next update in 1:23": its own component, so only it re-renders every second. */
function NextUpdate({ at }: { at: number }) {
  const now = useNow(1_000);
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span className="muted small feed-next">
      <span className="feed-next-long">Updates every 2 min · </span>next in {label}
    </span>
  );
}

// Memoised: rows only re-render when their own edit changes (e.g. a new flag).
const FeedItem = memo(function FeedItem({ edit }: { edit: Edit }) {
  const deltaClass = edit.delta === null ? "" : edit.delta < 0 ? "delta-neg" : "delta-pos";
  const flagged = edit.flag && edit.flag.status !== "cleared";
  return (
    <li className={`feed-item ${flagged ? "feed-item-flagged" : ""}`} data-wiki={edit.wiki} data-id={edit.id}>
      <div className="feed-top">
        <time className="feed-time">{formatClock(edit.timestamp)}</time>
        <span className="wiki-tag">{wikiLabel(edit.wiki)}</span>
        {edit.type === "new" && <span className="chip chip-new">New page</span>}
        <a className="feed-title" href={safeUrl(edit.diff_url ?? edit.url)} target="_blank" rel="noreferrer noopener">
          <bdi>{edit.title}</bdi>
        </a>
        <span className={`feed-delta ${deltaClass}`}>{formatDelta(edit.delta)}</span>
      </div>
      <div className="feed-bottom">
        <span className="feed-user">
          <bdi>{edit.user}</bdi>
          {edit.bot && <span className="chip chip-bot">bot</span>}
        </span>
        {edit.comment && <bdi className="feed-comment">{edit.comment}</bdi>}
        {edit.flag && <FlagBadge flag={edit.flag} />}
      </div>
    </li>
  );
});
