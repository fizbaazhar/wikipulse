import { memo, useMemo } from "react";
import { useElementWidth } from "../hooks/useElementWidth";
import { formatClock } from "../lib/format";
import { prefersReducedMotion } from "../lib/motion";
import { SERIES } from "./colors";
import { bandPath, monotonePath, niceCeil } from "./geometry";
import { SrTable } from "./SrTable";
import { LegendItem, Tooltip, useHoverIndex } from "./Tooltip";
import { YAxis } from "./YAxis";

interface Props {
  series: { t: number; human: number; bot: number }[];
}

const HEIGHT = 180;
const PAD = { top: 14, right: 56, bottom: 22, left: 36 };

/**
 * Edits per second for the last two minutes, humans and bots stacked.
 *
 * The data moves one second to the left each tick. Instead of jumping, the
 * plot is drawn one step to the right and slides back over one second, so the
 * line scrolls continuously like a heart monitor.
 */
export const LiveHeartbeat = memo(function LiveHeartbeat({ series }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const n = series.length;
  const { hover, setHover, clear } = useHoverIndex(n);

  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const max = niceCeil(Math.max(1, ...series.map((p) => p.human + p.bot)));
  const x = (i: number) => PAD.left + i * step;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const { humanArea, botArea, totalLine, humanLine } = useMemo(() => {
    const base = series.map((_, i) => [x(i), y(0)] as [number, number]);
    const humanTop = series.map((p, i) => [x(i), y(p.human)] as [number, number]);
    const totalTop = series.map((p, i) => [x(i), y(p.human + p.bot)] as [number, number]);
    return {
      humanArea: bandPath(humanTop, base),
      botArea: bandPath(totalTop, humanTop),
      totalLine: monotonePath(totalTop),
      humanLine: monotonePath(humanTop),
    };
  }, [series, plotW, max]); // x and y are derived from exactly these

  const last = series[n - 1];
  const lastTotal = last ? last.human + last.bot : 0;
  const avg = n ? Math.round(series.reduce((s, p) => s + p.human + p.bot, 0) / n) : 0;
  const animate = !prefersReducedMotion();

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (n === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round((e.clientX - box.left) / step))));
  };
  // The series shifts every second under a still pointer: read the hovered
  // second from the current data rather than from when the pointer moved.
  const hovered = hover === null ? null : series[hover];
  const tip =
    hover === null || !hovered
      ? null
      : {
          x: x(hover),
          y: y(hovered.human + hovered.bot),
          title: `${formatClock(hovered.t)} · ${hovered.human + hovered.bot} edits/s`,
          rows: [
            { color: SERIES.human, label: "humans", value: String(hovered.human) },
            { color: SERIES.bot, label: "bots", value: String(hovered.bot) },
          ],
        };

  return (
    <section className="card heartbeat" aria-labelledby="hb-title">
      <div className="card-head">
        <div>
          <h2 id="hb-title">Live heartbeat</h2>
          <p className="muted small">Edits per second · last 2 minutes · average {avg}/s</p>
        </div>
        <div className="legend">
          <LegendItem color={SERIES.human} label="Humans" />
          <LegendItem color={SERIES.bot} label="Bots" />
        </div>
      </div>
      <div ref={ref} className="chart-wrap">
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} className="chart-svg" role="img" aria-label={`Edits per second, now ${lastTotal} per second`}>
          <defs>
            <clipPath id="hb-clip">
              <rect x={PAD.left} y={0} width={plotW} height={HEIGHT} />
            </clipPath>
          </defs>
          <YAxis ticks={[0, max / 2, max]} left={PAD.left} width={plotW} y={y} />
          <text x={PAD.left} y={HEIGHT - 4} className="chart-label">
            −2 min
          </text>
          <text x={PAD.left + plotW} y={HEIGHT - 4} textAnchor="end" className="chart-label">
            now
          </text>

          <g clipPath="url(#hb-clip)">
            {/* Remounted every second (key) so the slide animation restarts. */}
            <g key={last?.t} className={animate ? "hb-scroll" : undefined} style={{ ["--shift" as string]: `${step}px` }}>
              <path d={humanArea} fill={SERIES.human} className="area-fill" />
              <path d={botArea} fill={SERIES.bot} className="area-fill" />
              <path d={humanLine} stroke={SERIES.human} className="line" />
              <path d={totalLine} stroke={SERIES.bot} className="line" />
            </g>
          </g>

          {last && (
            <g>
              <circle cx={x(n - 1)} cy={y(lastTotal)} r={4} fill={SERIES.bot} className="end-dot" />
              <text x={x(n - 1) + 10} y={y(lastTotal) + 4} className="chart-value">
                {lastTotal}/s
              </text>
            </g>
          )}

          {tip && hovered && (
            <g pointerEvents="none">
              <line x1={tip.x} x2={tip.x} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />
              <circle cx={tip.x} cy={y(hovered.human)} r={4} fill={SERIES.human} className="end-dot" />
              <circle cx={tip.x} cy={tip.y} r={4} fill={SERIES.bot} className="end-dot" />
            </g>
          )}
          <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={clear} />
        </svg>
        <Tooltip tip={tip} width={width} />
      </div>
      <SrTable
        caption="Edits per second, last 2 minutes"
        headers={["Time", "Humans", "Bots"]}
        rows={series.slice(-30).map((p) => [formatClock(p.t), p.human, p.bot])}
      />
    </section>
  );
});
