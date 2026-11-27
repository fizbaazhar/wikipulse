/**
 * Placeholder rows shown while the first data is on its way, shaped like the
 * content they stand in for. Screen readers hear one "Loading" message.
 */
interface Props {
  /** How many placeholder rows. */
  rows?: number;
  /** "lines" for text, "list" for rows with a short tag at the end. */
  variant?: "lines" | "list";
  /** What is loading, read out to screen readers. */
  label?: string;
  /** Optional caption under the rows. */
  caption?: string;
}

// Fixed widths so the placeholders look like ragged text, and don't jump between renders.
const WIDTHS = [92, 78, 85, 64, 88, 72, 81, 68, 90, 75];

export function Skeleton({ rows = 3, variant = "lines", label = "Loading", caption }: Props) {
  return (
    <div className={`skeleton skeleton-${variant}`} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <span className="skeleton-bar" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
          {variant === "list" && <span className="skeleton-bar skeleton-tag" />}
        </div>
      ))}
      {caption && <p className="muted small skeleton-caption">{caption}</p>}
    </div>
  );
}
