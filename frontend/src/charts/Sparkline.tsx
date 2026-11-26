import { monotonePath } from "./geometry";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  label: string;
}

/**
 * Tiny trend line for a list row: the history in the de-emphasis
 * colour, the latest point marked in the accent.
 */
export function Sparkline({ values, width = 64, height = 20, label }: Props) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pad = 3;
  const step = (width - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, height - pad - (v / max) * (height - pad * 2)] as [number, number]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="sparkline" role="img" aria-label={label}>
      <path d={monotonePath(pts)} className="sparkline-line" />
      <circle cx={lx} cy={ly} r={2.5} className="sparkline-dot" />
    </svg>
  );
}

/** "rising" when the latest fifth of the window is clearly busier than the average. */
export function trendDirection(values: number[]): "rising" | "falling" | "steady" {
  if (values.length < 4) return "steady";
  const recent = (values[values.length - 1] + values[values.length - 2]) / 2;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (recent >= 2 && recent > mean * 1.5) return "rising";
  if (mean >= 1 && recent < mean * 0.4) return "falling";
  return "steady";
}
