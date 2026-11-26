import { memo } from "react";
import { useElementWidth } from "../hooks/useElementWidth";
import { formatNumber, windowMinutes } from "../lib/format";
import type { SizeBin } from "../types";
import { SERIES } from "./colors";
import { niceCeil, roundedTopRect } from "./geometry";
import { SrTable } from "./SrTable";
import { LegendItem, Tooltip, useHoverIndex } from "./Tooltip";
import { YAxis } from "./YAxis";

interface Props {
  bins: SizeBin[];
  windowSeconds: number;
}

const HEIGHT = 170;
const PAD = { top: 16, right: 4, bottom: 22, left: 36 };

const RANGES: Record<string, string> = {
  "−10K+": "removed 10,000+ bytes",
  "−1K": "removed 1,000–9,999 bytes",
  "−100": "removed 100–999 bytes",
  "−10": "removed 10–99 bytes",
  "−1": "removed 1–9 bytes",
  "0": "no size change",
  "+1": "added 1–9 bytes",
  "+10": "added 10–99 bytes",
  "+100": "added 100–999 bytes",
  "+1K": "added 1,000–9,999 bytes",
  "+10K+": "added 10,000+ bytes",
};

const colorFor = (sign: SizeBin["sign"]) => (sign < 0 ? SERIES.removed : sign > 0 ? SERIES.added : SERIES.unchanged);

/**
 * How big edits are, on a log scale of bytes changed: removals (left, red)
 * diverge from additions (right, blue) around "no change". Large removals are
 * the classic shape of blanking vandalism.
 */
export const EditSizeChart = memo(function EditSizeChart({ bins, windowSeconds }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>(320);
  const { hover, setHover, clear } = useHoverIndex(bins.length);

  const total = bins.reduce((s, b) => s + b.count, 0);
  const max = niceCeil(Math.max(1, ...bins.map((b) => b.count)));
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = bins.length ? plotW / bins.length : plotW;
  const barW = Math.min(24, band - 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const removed = bins.filter((b) => b.sign < 0).reduce((s, b) => s + b.count, 0);
  const share = (count: number) => (total ? Math.round((count / total) * 100) : 0);
  const hovered = hover === null ? null : bins[hover];
  const tip =
    hover === null || !hovered
      ? null
      : {
          x: PAD.left + hover * band + band / 2,
          y: y(hovered.count),
          title: RANGES[hovered.label] ?? hovered.label,
          rows: [
            {
              color: colorFor(hovered.sign),
              label: `edits (${share(hovered.count)}%)`,
              value: formatNumber(hovered.count),
            },
          ],
        };

  return (
    <section className="card sizes" aria-labelledby="sizes-title">
      <div className="card-head">
        <div>
          <h2 id="sizes-title">Edit size</h2>
          <p className="muted small">
            Bytes changed · last {windowMinutes(windowSeconds)} min · {share(removed)}% remove content
          </p>
        </div>
        <div className="legend">
          <LegendItem color={SERIES.removed} label="Removed" />
          <LegendItem color={SERIES.added} label="Added" />
        </div>
      </div>
      <div ref={ref} className="chart-wrap">
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} className="chart-svg" role="img" aria-label="Distribution of edit sizes">
          <YAxis ticks={[0, max]} left={PAD.left} width={plotW} y={y} />
          {bins.map((b, i) => {
            const x = PAD.left + i * band + (band - barW) / 2;
            const top = y(b.count);
            return (
              <g key={b.label} className={hover === i ? "stack-hover" : undefined}>
                <path d={roundedTopRect(x, top, barW, y(0) - top)} fill={colorFor(b.sign)} className="bar" />
                {(i % 2 === 0 || width > 420) && (
                  <text x={PAD.left + i * band + band / 2} y={HEIGHT - 6} textAnchor="middle" className="chart-label">
                    {b.label}
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
      <SrTable caption="Edits by size change" headers={["Size change", "Edits"]} rows={bins.map((b) => [RANGES[b.label] ?? b.label, b.count])} />
    </section>
  );
});
