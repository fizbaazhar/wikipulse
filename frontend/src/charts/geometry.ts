// Small, dependency-free helpers shared by the SVG charts.

/** Round a maximum up to a clean axis limit: 1, 2, 5 × 10^n. */
export function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= n) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Axis tick label: full numbers under 10,000, compact above (10K, 1.2M). */
export function formatTick(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `${Math.round(n / 1_000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

type Point = [number, number];

/**
 * Smooth path through points that never overshoots the data (monotone cubic,
 * Fritsch–Carlson), so a smoothed line never shows a value that did not occur.
 */
export function monotonePath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1][0] - points[i][0]);
    slope.push((points[i + 1][1] - points[i][1]) / (dx[i] || 1));
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }

  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${x0 + h},${y0 + tangent[i] * h} ${x1 - h},${y1 - tangent[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

/** Closed area between an upper line and a lower line (both left → right). */
export function bandPath(upper: Point[], lower: Point[]): string {
  if (upper.length === 0) return "";
  const top = monotonePath(upper);
  const bottomReversed = monotonePath([...lower].reverse()).replace(/^M/, "L");
  return `${top}${bottomReversed}Z`;
}

/** Column with a 4px rounded data-end and a square base (for the top of a stack). */
export function roundedTopRect(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return "";
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}
