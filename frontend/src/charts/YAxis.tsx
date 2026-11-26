import { formatTick } from "./geometry";

interface Props {
  /** Values to draw a gridline at; 0 is drawn as the axis line. */
  ticks: number[];
  /** Left edge of the plot area (labels sit just left of it). */
  left: number;
  /** Width of the plot area. */
  width: number;
  /** Maps a value to its y position. */
  y: (value: number) => number;
}

/** Horizontal gridlines with their value labels, shared by the SVG charts. */
export function YAxis({ ticks, left, width, y }: Props) {
  return ticks.map((t) => (
    <g key={t}>
      <line x1={left} x2={left + width} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-axis" : "chart-grid"} />
      <text x={left - 6} y={y(t) + 4} textAnchor="end" className="chart-label">
        {formatTick(t)}
      </text>
    </g>
  ));
}
