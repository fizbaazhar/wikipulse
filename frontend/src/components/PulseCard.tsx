import { useState } from "react";
import { timeAgo } from "../lib/format";
import type { AiInfo, Pulse } from "../types";
import { Skeleton } from "./Skeleton";

interface Props {
  pulse: Pulse | null;
  ai: AiInfo;
  now: number;
  onRefresh: () => Promise<boolean>;
}

export function PulseCard({ pulse, ai, now, onRefresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const refreshed = await onRefresh();
      if (!refreshed) setMessage("Just refreshed, try again in a few seconds.");
    } catch {
      setMessage("Could not refresh right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card pulse ${pulse?.source === "ai" ? "pulse-ai" : ""}`} aria-labelledby="pulse-title">
      <div className="card-head">
        <h2 id="pulse-title">
          <svg className="pulse-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" />
            <path d="M19 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
          </svg>
          Pulse
        </h2>
        <div className="pulse-meta">
          {pulse && (
            <span className={`chip ${pulse.source === "ai" ? "chip-ai" : ""}`} title={ai.model ?? undefined}>
              {pulse.source === "ai" ? (
                <>
                  AI summary{ai.model && <span className="chip-model">· {ai.model}</span>}
                </>
              ) : (
                "Rule-based summary"
              )}
            </span>
          )}
          <button type="button" className="btn-ghost" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      {pulse ? (
        <>
          <p className="pulse-headline" key={pulse.generated_at}>
            {pulse.headline}
          </p>
          <p className="pulse-summary">{pulse.summary}</p>
          <p className="muted small">
            Updated {timeAgo(pulse.generated_at, now)}
            {pulse.note ? ` · ${pulse.note}` : ""}
            {!ai.enabled && pulse.source !== "ai" ? " · add an API key for AI summaries" : ""}
          </p>
        </>
      ) : (
        <Skeleton rows={4} label="Loading the summary" caption="Writing the first summary…" />
      )}
      {message && <p className="muted small">{message}</p>}
    </section>
  );
}
