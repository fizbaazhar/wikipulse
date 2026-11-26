import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEdit, makeFlag } from "../test/fixtures";
import type { Edit } from "../types";
import { useDripFeed } from "./useDripFeed";

const ids = (list: Edit[]) => list.map((e) => e.id);
const batch = (...names: string[]) => names.map((id) => makeEdit({ id }));

describe("useDripFeed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the first list at once", () => {
    const { result } = renderHook(() => useDripFeed(batch("b", "a")));
    expect(ids(result.current.shown)).toEqual(["b", "a"]);
  });

  it("releases a new batch gradually, oldest first, within about a second", () => {
    const { result, rerender } = renderHook(({ edits }) => useDripFeed(edits, { intervalMs: 100, drainMs: 400 }), {
      initialProps: { edits: batch("a") },
    });
    // Server sends 4 new edits at once (newest first in state).
    rerender({ edits: batch("e", "d", "c", "b", "a") });
    expect(ids(result.current.shown)).toEqual(["a"]);
    expect(result.current.queued).toBe(4);

    act(() => vi.advanceTimersByTime(100));
    expect(ids(result.current.shown)).toEqual(["b", "a"]);

    act(() => vi.advanceTimersByTime(400));
    expect(ids(result.current.shown)).toEqual(["e", "d", "c", "b", "a"]);
    expect(result.current.queued).toBe(0);
  });

  it("holds while the user is reading, and flush releases everything", () => {
    const { result, rerender } = renderHook(({ edits, hold }) => useDripFeed(edits, { hold, intervalMs: 50 }), {
      initialProps: { edits: batch("a"), hold: true },
    });
    rerender({ edits: batch("c", "b", "a"), hold: true });
    act(() => vi.advanceTimersByTime(2000));
    expect(ids(result.current.shown)).toEqual(["a"]);
    expect(result.current.queued).toBe(2);

    act(() => result.current.flush());
    expect(ids(result.current.shown)).toEqual(["c", "b", "a"]);
  });

  it("applies flag updates to visible edits immediately", () => {
    const { result, rerender } = renderHook(({ edits }) => useDripFeed(edits), {
      initialProps: { edits: batch("a") },
    });
    rerender({ edits: [makeEdit({ id: "a", flag: makeFlag({ status: "cleared" }) })] });
    expect(result.current.shown[0].flag?.status).toBe("cleared");
  });

  it("replaces the list at once when the reset key changes (wiki filter changed)", () => {
    // The filtered list shares edits with the unfiltered one; it must still replace it.
    const { result, rerender } = renderHook(({ edits, key }) => useDripFeed(edits, { resetKey: key }), {
      initialProps: { edits: batch("en1", "fr1", "en2"), key: 1 },
    });
    rerender({ edits: batch("fr2", "fr1"), key: 2 });
    expect(ids(result.current.shown)).toEqual(["fr2", "fr1"]);
    expect(result.current.queued).toBe(0);
  });
});
