// Shapes sent by the back end. See the protocol docstring in backend/app/main.py.

type FlagStatus = "suspect" | "reviewing" | "flagged" | "cleared";

export interface Flag {
  status: FlagStatus;
  score: number;
  reason: string;
  signals: string[];
  source: "rules" | "ai";
  ai_confidence: number | null;
  note: string | null;
}

export interface Edit {
  id: string;
  wiki: string;
  title: string;
  url: string;
  user: string;
  bot: boolean;
  type: "edit" | "new";
  namespace: number;
  comment: string;
  timestamp: number | null;
  minor: boolean;
  length_old: number | null;
  length_new: number | null;
  delta: number | null;
  diff_url: string | null;
  flag: Flag | null;
}

export interface TopPage {
  wiki: string;
  title: string;
  count: number;
  url: string;
  /** Edits per slice of the window, oldest first (sparkline). */
  trend: number[];
}

export interface SizeBin {
  label: string;
  /** -1 removed content, 0 no change, 1 added content. */
  sign: -1 | 0 | 1;
  count: number;
}

export interface Snapshot {
  generated_at: number;
  wiki: string | null;
  window_seconds: number;
  edits_last_minute: number;
  edits_in_window: number;
  bot_share: number;
  edits_per_minute: { minute: number; count: number }[];
  /** Per-minute counts split by the busiest wikis; "other" holds the rest. */
  wiki_minutes: { keys: string[]; points: { minute: number; counts: Record<string, number> }[] };
  /** Humans vs bots per completed second, oldest first. */
  per_second: { t: number; human: number; bot: number }[];
  editors: { registered: number; bot: number; anonymous: number };
  size_histogram: SizeBin[];
  top_pages: TopPage[];
  wikis: { wiki: string; count: number }[];
}

export interface Pulse {
  headline: string;
  summary: string;
  source: "ai" | "rules";
  generated_at: number;
  note: string | null;
}

export interface SourceInfo {
  source: "live" | "replay";
  connected: boolean;
  [key: string]: unknown;
}

export interface AiInfo {
  enabled: boolean;
  model: string | null;
}

interface InitialState {
  recent: Edit[];
  flagged: Edit[];
  snapshot: Snapshot;
  pulse: Pulse | null;
}

export type ServerMessage =
  | ({ type: "hello"; source: SourceInfo; ai: AiInfo } & InitialState)
  | ({ type: "reset"; wiki: string | null } & InitialState)
  | { type: "edits"; items: Edit[] }
  | { type: "flags"; items: Edit[] }
  | { type: "pulse"; data: Pulse }
  | { type: "snapshot"; data: Snapshot }
  | { type: "error"; message: string };
