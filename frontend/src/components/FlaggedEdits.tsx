import { memo, useMemo } from "react";
import { formatClock, safeUrl, wikiLabel } from "../lib/format";
import type { AiInfo, Edit, Flag } from "../types";
import { FlagBadge } from "./FlagBadge";
import { Skeleton } from "./Skeleton";

interface Props {
  edits: Edit[];
  ai: AiInfo;
  /** No data from the server yet. */
  loading?: boolean;
}

/** Most serious first; within a level, newest first (input order). */
const RANK: Record<Flag["status"], number> = { flagged: 0, suspect: 1, reviewing: 2, cleared: 3 };

export const FlaggedEdits = memo(function FlaggedEdits({ edits, ai, loading = false }: Props) {
  const { open, cleared, counts } = useMemo(() => {
    const withFlag = edits.filter((e): e is Edit & { flag: Flag } => e.flag != null);
    const open = withFlag
      .filter((e) => e.flag.status !== "cleared")
      .map((e, i) => ({ e, i }))
      .sort((a, b) => RANK[a.e.flag.status] - RANK[b.e.flag.status] || a.i - b.i)
      .map(({ e }) => e);
    const cleared = withFlag.filter((e) => e.flag.status === "cleared");
    const counts = {
      flagged: open.filter((e) => e.flag.status === "flagged").length,
      suspect: open.filter((e) => e.flag.status === "suspect").length,
    };
    return { open, cleared, counts };
  }, [edits]);

  return (
    <section className="card flagged" aria-labelledby="flagged-title">
      <div className="card-head">
        <h2 id="flagged-title">Possible vandalism</h2>
        <span className="muted small">{ai.enabled ? "rules + AI review" : "rules only"}</span>
      </div>
      {(counts.flagged > 0 || counts.suspect > 0 || cleared.length > 0) && (
        <div className="flag-summary" aria-label="Flag counts">
          <span className="flag-count flag-count-flagged">
            <strong>{counts.flagged}</strong> likely
          </span>
          <span className="flag-count flag-count-suspect">
            <strong>{counts.suspect}</strong> suspicious
          </span>
          <span className="flag-count flag-count-cleared">
            <strong>{cleared.length}</strong> cleared
          </span>
        </div>
      )}
      {loading ? (
        <Skeleton rows={4} variant="list" label="Loading flagged edits" />
      ) : open.length === 0 && cleared.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">✓</span>
          <p>Nothing suspicious so far.</p>
        </div>
      ) : (
        <div className="flagged-list">
          {open.length === 0 ? (
            <p className="muted small flagged-calm">No open flags. Everything reviewed so far was cleared.</p>
          ) : (
            <ul className="flagged-open">
              {open.map((e) => (
                <FlagItem key={e.id} edit={e} />
              ))}
            </ul>
          )}
          {cleared.length > 0 && (
            <details className="flagged-cleared-group">
              <summary>
                Cleared after review <span className="muted">({cleared.length})</span>
              </summary>
              <ul>
                {cleared.map((e) => (
                  <FlagItem key={e.id} edit={e} compact />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
});

function FlagItem({ edit: e, compact = false }: { edit: Edit & { flag: Flag }; compact?: boolean }) {
  return (
    <li className={`flagged-item flagged-${e.flag.status}`}>
      <div className="flagged-top">
        <FlagBadge flag={e.flag} />
        <span className="muted small">
          {wikiLabel(e.wiki)} · {formatClock(e.timestamp)}
        </span>
      </div>
      <a className="flagged-title" href={safeUrl(e.diff_url ?? e.url)} target="_blank" rel="noreferrer noopener">
        <bdi>{e.title}</bdi>
      </a>
      <p className="flagged-reason">{e.flag.reason}</p>
      <p className="muted small">
        by <bdi>{e.user}</bdi>
        {e.flag.ai_confidence !== null && ` · AI confidence ${Math.round(e.flag.ai_confidence * 100)}%`}
        {e.flag.note && ` · ${e.flag.note}`}
      </p>
      {!compact && e.comment && (
        <p className="flagged-comment" title={e.comment}>
          “{e.comment}”
        </p>
      )}
    </li>
  );
}
