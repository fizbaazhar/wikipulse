import { memo } from "react";
import { formatNumber, windowMinutes } from "../lib/format";
import type { Snapshot } from "../types";
import { SERIES } from "./colors";
import { LegendItem } from "./Tooltip";

interface Props {
  editors: Snapshot["editors"];
  windowSeconds: number;
}

const PARTS = [
  { key: "registered", label: "Registered users", color: SERIES.human },
  { key: "bot", label: "Bots", color: SERIES.bot },
  { key: "anonymous", label: "Logged out", color: SERIES.anonymous },
] as const;

/** Who is editing: one whole split into three parts, as a tall segmented bar. */
export const EditorMix = memo(function EditorMix({ editors, windowSeconds }: Props) {
  const total = editors.registered + editors.bot + editors.anonymous;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <section className="card editors" aria-labelledby="editors-title">
      <div className="card-head">
        <div>
          <h2 id="editors-title">Who is editing</h2>
          <p className="muted small">Last {windowMinutes(windowSeconds)} min · {formatNumber(total)} edits</p>
        </div>
      </div>
      <div className="segbar" role="img" aria-label={PARTS.map((p) => `${p.label} ${share(editors[p.key])}%`).join(", ")}>
        {total === 0 ? (
          <div className="segbar-empty" />
        ) : (
          PARTS.filter((p) => editors[p.key] > 0).map((p) => {
            const pct = share(editors[p.key]);
            return (
              <div
                key={p.key}
                className="segbar-part"
                style={{ flexGrow: editors[p.key], background: p.color }}
                title={`${p.label}: ${formatNumber(editors[p.key])} edits (${pct}%)`}
              >
                {(editors[p.key] / total) * 100 >= 12 && <span>{pct}%</span>}
              </div>
            );
          })
        )}
      </div>
      <div className="legend legend-stacked">
        {PARTS.map((p) => (
          <LegendItem
            key={p.key}
            color={p.color}
            label={
              <>
                {p.label} <span className="muted">· {formatNumber(editors[p.key])}</span>
              </>
            }
          />
        ))}
      </div>
    </section>
  );
});
