import { describe, expect, it } from "vitest";
import { makeEdit, makeFlag, makeSnapshot } from "../test/fixtures";
import type { ServerMessage } from "../types";
import { MAX_FEED, initialState, reducer, type DashboardState } from "./dashboard";

const msg = (message: ServerMessage) => ({ type: "message" as const, message });

function hello(overrides: Partial<Extract<ServerMessage, { type: "hello" }>> = {}): ServerMessage {
  return {
    type: "hello",
    source: { source: "live", connected: true },
    ai: { enabled: true, model: "m" },
    recent: [makeEdit({ id: "a" }), makeEdit({ id: "b" })], // oldest first, as sent
    flagged: [],
    snapshot: makeSnapshot(),
    pulse: null,
    ...overrides,
  };
}

/** The feed starts paused; most tests want it following the stream. */
const live: DashboardState = { ...initialState, paused: false };

const ids = (state: DashboardState, key: "edits" | "pending" | "flagged" = "edits") => state[key].map((e) => e.id);

describe("dashboard reducer", () => {
  it("hello replaces state and shows newest edits first", () => {
    const state = reducer(initialState, msg(hello()));
    expect(ids(state)).toEqual(["b", "a"]);
    expect(state.source?.source).toBe("live");
    expect(state.ai.enabled).toBe(true);
    expect(state.snapshot?.edits_last_minute).toBe(42);
  });

  it("starts paused", () => {
    expect(initialState.paused).toBe(true);
  });

  it("new edits are prepended, duplicates skipped and the feed capped", () => {
    let state = reducer(live, msg(hello()));
    state = reducer(state, msg({ type: "edits", items: [makeEdit({ id: "b" }), makeEdit({ id: "c" }), makeEdit({ id: "d" })] }));
    expect(ids(state)).toEqual(["d", "c", "b", "a"]);

    const many = Array.from({ length: MAX_FEED + 50 }, (_, i) => makeEdit({ id: `x${i}` }));
    state = reducer(state, msg({ type: "edits", items: many }));
    expect(state.edits).toHaveLength(MAX_FEED);
    expect(state.edits[0].id).toBe(`x${MAX_FEED + 49}`);
  });

  it("pausing freezes the feed and buffers new edits until resume", () => {
    let state = reducer(reducer(live, msg(hello())), { type: "togglePause" });
    state = reducer(state, msg({ type: "edits", items: [makeEdit({ id: "c" })] }));
    expect(ids(state)).toEqual(["b", "a"]);
    expect(ids(state, "pending")).toEqual(["c"]);

    state = reducer(state, { type: "togglePause" });
    expect(state.paused).toBe(false);
    expect(ids(state)).toEqual(["c", "b", "a"]);
    expect(state.pending).toEqual([]);
  });

  it("a paused feed catches up on refresh, stays paused and replaces in one block", () => {
    let state = reducer(initialState, msg(hello()));
    state = reducer(state, msg({ type: "edits", items: [makeEdit({ id: "c" }), makeEdit({ id: "d" })] }));
    expect(ids(state)).toEqual(["b", "a"]);
    const version = state.feedVersion;

    state = reducer(state, { type: "refreshFeed" });
    expect(ids(state)).toEqual(["d", "c", "b", "a"]);
    expect(state.pending).toEqual([]);
    expect(state.paused).toBe(true);
    expect(state.feedVersion).toBe(version + 1);
  });

  it("refresh does nothing when live or when nothing is waiting", () => {
    const paused = reducer(initialState, msg(hello()));
    expect(reducer(paused, { type: "refreshFeed" })).toBe(paused);
    const following = reducer(live, msg(hello()));
    expect(reducer(following, { type: "refreshFeed" })).toBe(following);
  });

  it("flagged edits in the stream go to the vandalism panel", () => {
    let state = reducer(initialState, msg(hello()));
    state = reducer(state, msg({ type: "edits", items: [makeEdit({ id: "v", flag: makeFlag({ status: "reviewing" }) })] }));
    expect(ids(state, "flagged")).toEqual(["v"]);
  });

  it("a late AI verdict updates the edit everywhere it appears", () => {
    let state = reducer(live, msg(hello()));
    state = reducer(state, msg({ type: "edits", items: [makeEdit({ id: "v", flag: makeFlag({ status: "reviewing" }) })] }));

    const verdict = makeEdit({ id: "v", flag: makeFlag({ status: "cleared", source: "ai", reason: "Routine trim" }) });
    state = reducer(state, msg({ type: "flags", items: [verdict] }));

    expect(state.edits.find((e) => e.id === "v")?.flag?.status).toBe("cleared");
    expect(state.flagged).toHaveLength(1);
    expect(state.flagged[0].flag?.reason).toBe("Routine trim");
  });

  it("reset after changing wiki replaces the feed and drops buffered edits", () => {
    let state = reducer(initialState, msg(hello())); // paused
    state = reducer(state, msg({ type: "edits", items: [makeEdit({ id: "c" })] }));
    state = reducer(
      state,
      msg({ type: "reset", wiki: "frwiki", recent: [makeEdit({ id: "fr", wiki: "frwiki" })], flagged: [], snapshot: makeSnapshot(), pulse: null }),
    );
    expect(state.wiki).toBe("frwiki");
    expect(ids(state)).toEqual(["fr"]);
    expect(state.pending).toEqual([]);
    expect(state.feedVersion).toBe(2); // hello + reset: the feed knows to replace, not trickle
  });

  it("keeps the previous pulse when a reset carries none", () => {
    let state = reducer(initialState, msg({ type: "pulse", data: { headline: "h", summary: "s", source: "ai", generated_at: 1, note: null } }));
    state = reducer(state, msg(hello({ pulse: null })));
    expect(state.pulse?.headline).toBe("h");
  });
});
