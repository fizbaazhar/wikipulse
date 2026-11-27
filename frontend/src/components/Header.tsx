import { memo, useEffect, useRef, useState } from "react";
import { useTweenedNumber } from "../hooks/useTweenedNumber";
import type { Theme } from "../hooks/useTheme";
import { formatNumber, wikiNameAndId, windowMinutes } from "../lib/format";
import type { ConnectionStatus } from "../state/dashboard";
import type { Snapshot, SourceInfo } from "../types";
import { BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "../features/profile/UserMenu";

interface Props {
  connection: ConnectionStatus;
  source: SourceInfo | null;
  wiki: string | null;
  wikis: { wiki: string; count: number }[];
  onWikiChange: (wiki: string | null) => void;
  snapshot?: Snapshot | null;
  flaggedCount?: number;
  theme: Theme;
  onToggleTheme?: () => void;
  user?: string | null;
  onLogout?: () => void;
  /** Replays the guided tour. */
  onStartTour?: () => void;
}

const MAX_OPTIONS = 40;

/** Sticky command bar: status, live KPIs, wiki filter and theme — always in view. */
export function Header({
  connection,
  source,
  wiki,
  wikis,
  onWikiChange,
  snapshot = null,
  flaggedCount = 0,
  theme,
  onToggleTheme,
  user = null,
  onLogout,
  onStartTour,
}: Props) {
  const live = connection === "open" && source?.connected !== false;
  const statusText =
    connection === "open"
      ? source?.source === "replay"
        ? "Replay"
        : source?.connected === false
          ? "Reconnecting to Wikipedia…"
          : "Live"
      : connection === "connecting"
        ? "Connecting…"
        : "Offline, retrying…";

  return (
    <header className="header">
      <div className="brand">
        <BrandMark />
        <div>
          <h1>WikiPulse</h1>
          <p className="brand-sub">What Wikipedia is editing right now</p>
        </div>
      </div>

      <span className={`status ${live ? "status-live" : "status-down"}`} role="status">
        <span className="status-dot" aria-hidden="true" />
        {statusText}
      </span>

      <Kpis snapshot={snapshot} flaggedCount={flaggedCount} />

      <div className="header-controls">
        <WikiFilter wiki={wiki} wikis={wikis} onWikiChange={onWikiChange} />
        {onStartTour && (
          <button
            type="button"
            className="icon-btn tour-btn"
            onClick={onStartTour}
            aria-label="Take the tour"
            title="Take the tour"
          >
            ?
          </button>
        )}
        {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}
        {user && onLogout && <UserMenu user={user} onLogout={onLogout} />}
      </div>
    </header>
  );
}

/**
 * The wiki list is re-ranked every second. While the menu is open the options
 * are frozen, otherwise they move under the pointer and the pick is lost.
 */
function WikiFilter({ wiki, wikis, onWikiChange }: Pick<Props, "wiki" | "wikis" | "onWikiChange">) {
  const live = wikis.slice(0, MAX_OPTIONS).map((w) => w.wiki);
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const options = [...(frozen ?? live)];
  if (wiki && !options.includes(wiki)) options.unshift(wiki);
  const freeze = () => setFrozen((f) => f ?? live);
  const thaw = () => setFrozen(null);

  return (
    <label className="wiki-filter">
      <select
        aria-label="Filter by wiki"
        value={wiki ?? ""}
        onPointerDown={freeze}
        onFocus={freeze}
        onKeyDown={freeze}
        onBlur={thaw}
        onChange={(e) => {
          onWikiChange(e.target.value || null);
          thaw();
        }}
      >
        <option value="">All wikis</option>
        {options.map((w) => {
          const [name, id] = wikiNameAndId(w);
          return (
            <option key={w} value={w}>
              {id ? `${name} (${id})` : name}
            </option>
          );
        })}
      </select>
    </label>
  );
}

const Kpis = memo(function Kpis({ snapshot, flaggedCount }: { snapshot: Snapshot | null; flaggedCount: number }) {
  const windowMin = snapshot ? windowMinutes(snapshot.window_seconds) : 5;
  return (
    <div className="kpis" aria-label="Key numbers">
      <Kpi label="Edits / min" value={snapshot?.edits_last_minute} />
      <Kpi label={`Last ${windowMin} min`} value={snapshot?.edits_in_window} />
      <Kpi label="By bots" value={snapshot ? snapshot.bot_share * 100 : undefined} suffix="%" />
      <Kpi label="Wikis active" value={snapshot?.wikis.length} />
      <Kpi label="Flagged" value={snapshot ? flaggedCount : undefined} alert={flaggedCount > 0} bumpOnRise />
    </div>
  );
});

interface KpiProps {
  label: string;
  value?: number;
  suffix?: string;
  alert?: boolean;
  /** Flash the tile when the value goes up (e.g. a new vandalism flag). */
  bumpOnRise?: boolean;
}

function Kpi({ label, value, suffix = "", alert = false, bumpOnRise = false }: KpiProps) {
  const animated = useTweenedNumber(value ?? 0);
  const previous = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (bumpOnRise && value !== undefined && previous.current !== undefined && value > previous.current) {
      setBump((n) => n + 1);
    }
    previous.current = value;
  }, [value, bumpOnRise]);
  return (
    <div key={bump} className={`kpi ${alert ? "kpi-alert" : ""} ${bump ? "kpi-bump" : ""}`}>
      <span className="kpi-value">{value === undefined ? <span className="skeleton-bar kpi-skeleton" aria-hidden="true" /> : `${formatNumber(Math.round(animated))}${suffix}`}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
