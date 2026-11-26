import { memo } from "react";
import { Sparkline, trendDirection } from "../charts/Sparkline";
import { useReorderAnimation } from "../hooks/useReorderAnimation";
import { safeUrl, wikiLabel, windowMinutes } from "../lib/format";
import type { TopPage } from "../types";

interface Props {
  pages: TopPage[];
  windowSeconds: number;
}

export const TopPages = memo(function TopPages({ pages, windowSeconds }: Props) {
  const listRef = useReorderAnimation<HTMLOListElement>();
  const max = Math.max(1, ...pages.map((p) => p.count));
  const minutes = windowMinutes(windowSeconds);
  return (
    <section className="card top-pages" aria-labelledby="top-title">
      <div className="card-head">
        <h2 id="top-title">Most edited · last {minutes} min</h2>
      </div>
      {pages.length === 0 ? (
        <p className="muted">No edits yet.</p>
      ) : (
        <ol className="top-list" ref={listRef}>
          {pages.map((p, i) => {
            const key = `${p.wiki}:${p.title}`;
            const direction = trendDirection(p.trend ?? []);
            return (
              <li key={key} data-key={key} className="top-item">
                <span className="top-rank">{i + 1}</span>
                <div className="top-body">
                  <div className="top-line">
                    <a href={safeUrl(p.url)} target="_blank" rel="noreferrer noopener" className="top-title">
                      <bdi>{p.title}</bdi>
                    </a>
                    <span className="wiki-tag">{wikiLabel(p.wiki)}</span>
                    {direction === "rising" && (
                      <span className="trend-chip" title="Busier in the last minute than its 5-minute average">
                        ↑ rising
                      </span>
                    )}
                    <Sparkline values={p.trend ?? []} label={`Edits over the last ${minutes} minutes`} />
                    <span className="top-count">{p.count}</span>
                  </div>
                  <div className="top-bar-track" aria-hidden="true">
                    <div className="top-bar" style={{ width: `${(p.count / max) * 100}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});
