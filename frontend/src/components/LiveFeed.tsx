import { memo, useState } from "react";
import { useDripFeed } from "../hooks/useDripFeed";
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
}

/**
 * Live feed of recent edits, newest first.
 *
 * - New edits trickle in one by one (see `useDripFeed`) instead of jumping in
 *   per-second batches.
 * - Hovering (mouse or pen) or focusing the feed holds it still so a row can be read or
 *   clicked; a counter shows how many edits are waiting.
 * - Every piece of edit data is rendered as React text, never as HTML, so an
 *   edit summary like `<script>…</script>` shows up as harmless text.
 */
export function LiveFeed({ edits, feedVersion, paused, pendingCount, onTogglePause }: Props) {
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
          {(reading || paused) && waiting > 0 && (
            <button type="button" className="chip chip-waiting" onClick={paused ? onTogglePause : flush}>
              {waiting} new
            </button>
          )}
          {reading && !paused && <span className="muted small">Held while you read</span>}
          <button type="button" className="btn-ghost" onClick={onTogglePause}>
            {paused ? `Resume${pendingCount ? ` (${pendingCount} new)` : ""}` : "Pause"}
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

// Memoised: rows only re-render when their own edit changes (e.g. a new flag).
const FeedItem = memo(function FeedItem({ edit }: { edit: Edit }) {
  const deltaClass = edit.delta === null ? "" : edit.delta < 0 ? "delta-neg" : "delta-pos";
  const flagged = edit.flag && edit.flag.status !== "cleared";
  return (
    <li className={`feed-item ${flagged ? "feed-item-flagged" : ""}`} data-wiki={edit.wiki}>
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
