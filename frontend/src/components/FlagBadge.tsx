import type { Flag } from "../types";

const LABELS: Record<Flag["status"], string> = {
  flagged: "Likely vandalism",
  suspect: "Suspicious",
  reviewing: "AI reviewing…",
  cleared: "Cleared",
};

export function FlagBadge({ flag }: { flag: Flag }) {
  const title = [flag.reason, flag.note].filter(Boolean).join(" · ");
  return (
    <span className={`flag flag-${flag.status}`} title={title}>
      {LABELS[flag.status]}
      {flag.source === "ai" && <span className="flag-src">AI</span>}
    </span>
  );
}
