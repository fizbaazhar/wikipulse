import { useCallback, useState, type ReactNode } from "react";

interface TooltipRow {
  color: string;
  label: string;
  value: string;
}

interface TooltipContent {
  x: number;
  y: number;
  title: string;
  rows: TooltipRow[];
}

/**
 * Which data point (bar, second, bin) the pointer is over. Only the index is
 * kept: charts build the tooltip from their current data on every render, so
 * the numbers stay right while the data updates under a pointer that hasn't
 * moved. `hover` is null when nothing is hovered or the index has gone.
 */
export function useHoverIndex(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const clear = useCallback(() => setIndex(null), []);
  return { hover: index !== null && index < count ? index : null, setHover: setIndex, clear };
}

/**
 * Shared chart tooltip. Values lead (strong), names follow (secondary), and
 * each row is keyed with a short stroke of the series colour. All text goes
 * through React, so names from the stream are never interpreted as HTML.
 */
export function Tooltip({ tip, width }: { tip: TooltipContent | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 170;
  return (
    <div
      className="chart-tooltip"
      role="presentation"
      style={{ left: tip.x, top: tip.y, transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, -50%)` }}
    >
      <div className="chart-tooltip-title">{tip.title}</div>
      {tip.rows.map((row) => (
        <div key={row.label} className="chart-tooltip-row">
          <span className="chart-tooltip-key" style={{ background: row.color }} aria-hidden="true" />
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Legend entry: a swatch shaped like the mark (bar = rect, line = stroke) plus a text label. */
export function LegendItem({ color, label, shape = "rect" }: { color: string; label: ReactNode; shape?: "rect" | "line" }) {
  return (
    <span className="legend-item">
      <span className={shape === "line" ? "legend-line" : "legend-swatch"} style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}
