// All dashboard state lives in one pure reducer, so the tricky parts
// (de-duplication, pausing, applying late AI verdicts) are unit-testable
// without a browser or a server.
import type { AiInfo, Edit, Pulse, ServerMessage, Snapshot, SourceInfo } from "../types";

export const MAX_FEED = 200;
const MAX_FLAGGED = 50;

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface DashboardState {
  connection: ConnectionStatus;
  source: SourceInfo | null;
  ai: AiInfo;
  wiki: string | null;
  /** Live feed, newest first. */
  edits: Edit[];
  /** Edits that arrived while the feed was paused, newest first. */
  pending: Edit[];
  /** The feed starts paused and catches up every couple of minutes (see
   * `refreshFeed`); "Go live" makes it follow the stream edit by edit. */
  paused: boolean;
  /** Suspicious edits, newest first. */
  flagged: Edit[];
  snapshot: Snapshot | null;
  pulse: Pulse | null;
  lastError: string | null;
  /** Bumped whenever the server replaces the feed (hello / filter change). */
  feedVersion: number;
}

type Action =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "message"; message: ServerMessage }
  | { type: "setWiki"; wiki: string | null }
  | { type: "togglePause" }
  /** While paused: show everything that arrived since, and stay paused. */
  | { type: "refreshFeed" };

export const initialState: DashboardState = {
  connection: "connecting",
  source: null,
  ai: { enabled: false, model: null },
  wiki: null,
  edits: [],
  pending: [],
  paused: true,
  flagged: [],
  snapshot: null,
  pulse: null,
  lastError: null,
  feedVersion: 0,
};

/** Prepend `incoming` (oldest first, as sent) to `list` (newest first), skipping ids already present. */
function prependNew(list: Edit[], incoming: Edit[], max: number): Edit[] {
  const seen = new Set(list.map((e) => e.id));
  const fresh: Edit[] = [];
  for (let i = incoming.length - 1; i >= 0; i--) {
    const edit = incoming[i];
    if (!seen.has(edit.id)) {
      seen.add(edit.id);
      fresh.push(edit);
    }
  }
  return fresh.length ? [...fresh, ...list].slice(0, max) : list;
}

/** Replace edits in place by id (used when a flag changes). */
function replaceById(list: Edit[], updates: Map<string, Edit>): Edit[] {
  let changed = false;
  const next = list.map((e) => {
    const u = updates.get(e.id);
    if (u) changed = true;
    return u ?? e;
  });
  return changed ? next : list;
}

/** Update flagged edits in place, add new ones at the top. */
function upsertFlagged(list: Edit[], items: Edit[]): Edit[] {
  const withFlag = items.filter((e) => e.flag);
  if (!withFlag.length) return list;
  const updates = new Map(withFlag.map((e) => [e.id, e]));
  const updated = replaceById(list, updates);
  const known = new Set(list.map((e) => e.id));
  return prependNew(updated, withFlag.filter((e) => !known.has(e.id)), MAX_FLAGGED);
}

function applyMessage(state: DashboardState, msg: ServerMessage): DashboardState {
  switch (msg.type) {
    case "hello":
    case "reset":
      return {
        ...state,
        source: msg.type === "hello" ? msg.source : state.source,
        ai: msg.type === "hello" ? msg.ai : state.ai,
        wiki: msg.type === "reset" ? msg.wiki : state.wiki,
        edits: [...msg.recent].reverse().slice(0, MAX_FEED),
        pending: [],
        flagged: msg.flagged.slice(0, MAX_FLAGGED),
        snapshot: msg.snapshot,
        pulse: msg.pulse ?? state.pulse,
        lastError: null,
        feedVersion: state.feedVersion + 1,
      };
    case "edits":
      return {
        ...state,
        edits: state.paused ? state.edits : prependNew(state.edits, msg.items, MAX_FEED),
        pending: state.paused ? prependNew(state.pending, msg.items, MAX_FEED) : state.pending,
        flagged: upsertFlagged(state.flagged, msg.items),
      };
    case "flags": {
      const updates = new Map(msg.items.map((e) => [e.id, e]));
      return {
        ...state,
        edits: replaceById(state.edits, updates),
        pending: replaceById(state.pending, updates),
        flagged: upsertFlagged(state.flagged, msg.items),
      };
    }
    case "pulse":
      return { ...state, pulse: msg.data };
    case "snapshot":
      return { ...state, snapshot: msg.data };
    case "error":
      return { ...state, lastError: msg.message };
    default:
      return state;
  }
}

export function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.status };
    case "message":
      return applyMessage(state, action.message);
    case "setWiki":
      return { ...state, wiki: action.wiki };
    case "togglePause":
      if (state.paused) {
        return {
          ...state,
          paused: false,
          edits: [...state.pending, ...state.edits].slice(0, MAX_FEED),
          pending: [],
        };
      }
      return { ...state, paused: true };
    case "refreshFeed":
      if (!state.paused || state.pending.length === 0) return state;
      return {
        ...state,
        edits: [...state.pending, ...state.edits].slice(0, MAX_FEED),
        pending: [],
        // A catch-up lands as one block, not trickled in edit by edit.
        feedVersion: state.feedVersion + 1,
      };
    default:
      return state;
  }
}
