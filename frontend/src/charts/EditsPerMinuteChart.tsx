import { memo } from "react";
import { useElementWidth } from "../hooks/useElementWidth";
import { formatMinute, formatNumber, wikiLabel } from "../lib/format";
import type { Snapshot } from "../types";
import { SERIES, WIKI_SLOTS, useStableSlots } from "./colors";
import { niceCeil, roundedTopRect } from "./geometry";
import { SrTable } from "./SrTable";
import { LegendItem, Tooltip, useHoverIndex } from "./Tooltip";
import { YAxis } from "./YAxis";

interface Props {
  data: Snapshot["wiki_minutes"];
}

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 24, left: 44 };
const MAX_BAR = 24;
const GAP = 2; // surface gap between stacked segments

/**
 * Edits per minute for the last 30 minutes, each column split by wiki (the
 * five busiest, the rest folded into "Other"). Colours follow the wiki, not
 * its rank. The last column is the current, still-filling minute.
 */
export const EditsPerMinuteChart = memo(function EditsPerMinuteChart({ data }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();

  const wikis = data.keys.filter((k) => k !== "other");
  const slots = useStableSlots(wikis);
  const colorOf = (key: string) => (key === "other" ? SERIES.other : WIKI_SLOTS[slots.get(key) ?? 0]);
  const labelOf = (key: string) => (key === "other" ? "Other wikis" : wikiLabel(key));

  const points = data.points;
  const { hover, setHover, clear } = useHoverIndex(points.length);
  const totals = points.map((p) => Object.values(p.counts).reduce((a, b) => a + b, 0));
  const max = niceCeil(Math.max(1, ...totals));
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = points.length ? plotW / points.length : plotW;
  const barW = Math.min(MAX_BAR, Math.max(2, band * 0.7));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const labelEvery = width < 480 ? 10 : 5;
  const lastFull = totals.length >= 2 ? totals[totals.length - 2] : 0;

  // Built from the current data on each render: the still-filling last
  // minute keeps counting up while it is hovered.
  const hovered = hover === null ? null : points[hover];
  const tip =
    hover === null || !hovered
      ? null
      : {
          x: PAD.left + hover * band + band / 2,
          y: y(totals[hover]),
          title: `${formatMinute(hovered.minute)} · ${formatNumber(totals[hover])} edits${
            hover === points.length - 1 ? " so far" : ""
          }`,
          rows: [...data.keys].reverse().map((k) => ({
            color: colorOf(k),
            label: labelOf(k),
            value: formatNumber(hovered.counts[k] ?? 0),
          })),
        };

  return (
    <section className="card chart" aria-labelledby="epm-title">
      <div className="card-head">
        <div>
          <h2 id="epm-title">Edits per minute</h2>
          <p className="muted small">Last 30 minutes · last full minute {formatNumber(lastFull)}</p>
        </div>
        {data.keys.length > 1 && (
          <div className="legend">
            {data.keys.map((k) => (
              <LegendItem key={k} color={colorOf(k)} label={labelOf(k)} />
            ))}
          </div>
        )}
      </div>
      <div ref={ref} className="chart-wrap">
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} className="chart-svg" role="img" aria-label="Edits per minute by wiki over the last 30 minutes">
          <YAxis ticks={[0, max / 2, max]} left={PAD.left} width={plotW} y={y} />
          {points.map((p, i) => {
            const cx = PAD.left + i * band + (band - barW) / 2;
            const current = i === points.length - 1;
            const present = data.keys.filter((k) => (p.counts[k] ?? 0) > 0);
            let acc = 0;
            return (
              <g key={p.minute} className={`stack ${current ? "stack-current" : ""} ${hover === i ? "stack-hover" : ""}`}>
                {present.map((k, j) => {
                  const v = p.counts[k];
                  const top = y(acc + v);
                  const h = y(acc) - top;
                  acc += v;
                  const segH = Math.max(0, h - (j > 0 ? GAP : 0));
                  const isTop = j === present.length - 1;
                  return isTop ? (
                    <path key={k} d={roundedTopRect(cx, top, barW, segH)} fill={colorOf(k)} className="bar" />
                  ) : (
                    <rect key={k} x={cx} y={top} width={barW} height={segH} fill={colorOf(k)} className="bar" />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={PAD.left + i * band + band / 2} y={HEIGHT - 6} textAnchor="middle" className="chart-label">
                    {formatMinute(p.minute)}
                  </text>
                )}
                <rect
                  x={PAD.left + i * band}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={clear}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} width={width} />
      </div>
      <SrTable
        caption="Edits per minute by wiki"
        headers={["Minute", ...data.keys.map(labelOf)]}
        rows={points.map((p) => [formatMinute(p.minute), ...data.keys.map((k) => p.counts[k] ?? 0)])}
      />
    </section>
  );
});
