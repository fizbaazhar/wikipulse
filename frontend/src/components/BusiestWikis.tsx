import { memo } from "react";
import { useReorderAnimation } from "../hooks/useReorderAnimation";
import { formatNumber, wikiNameAndId } from "../lib/format";
import { Skeleton } from "./Skeleton";

interface Props {
  wikis: { wiki: string; count: number }[];
  selected: string | null;
  onSelect: (wiki: string | null) => void;
  /** No data from the server yet. */
  loading?: boolean;
}

const SHOWN = 8;

/**
 * Busiest wikis as ranked bars (one hue, emphasis on the selected wiki).
 * Each row is a button: clicking filters the whole dashboard to that wiki.
 */
export const BusiestWikis = memo(function BusiestWikis({ wikis, selected, onSelect, loading = false }: Props) {
  const listRef = useReorderAnimation<HTMLUListElement>();
  const total = wikis.reduce((s, w) => s + w.count, 0);
  const rows = wikis.slice(0, SHOWN);
  const max = Math.max(1, ...rows.map((w) => w.count));

  return (
    <section className="card wikis" aria-labelledby="wikis-title">
      <div className="card-head">
        <div>
          <h2 id="wikis-title">Busiest wikis</h2>
          <p className="muted small">{wikis.length} active · click to filter</p>
        </div>
        {selected && (
          <button type="button" className="btn-ghost" onClick={() => onSelect(null)}>
            Show all
          </button>
        )}
      </div>
      {loading && <Skeleton rows={5} variant="list" label="Loading wikis" />}
      <ul className="wiki-bars" ref={listRef}>
        {rows.map((w) => {
          const active = w.wiki === selected;
          const [name, id] = wikiNameAndId(w.wiki);
          return (
            <li key={w.wiki} data-key={w.wiki}>
              <button
                type="button"
                className={`wiki-bar ${active ? "wiki-bar-active" : ""}`}
                aria-pressed={active}
                onClick={() => onSelect(active ? null : w.wiki)}
                title={active ? "Show all wikis" : `Filter to ${name}`}
              >
                <span className="wiki-bar-name">
                  {name}
                  {id && <span className="muted"> {id}</span>}
                </span>
                <span className="wiki-bar-track" aria-hidden="true">
                  <span className="wiki-bar-fill" style={{ width: `${(w.count / max) * 100}%` }} />
                </span>
                <span className="wiki-bar-value">
                  {formatNumber(w.count)}
                  <span className="muted"> {total ? Math.round((w.count / total) * 100) : 0}%</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
