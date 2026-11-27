import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWikiPulse } from "./useWikiPulse";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  closeFromServer(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe("useWikiPulse", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stops reconnecting and reports when the server says the session ended", () => {
    const onUnauthorized = vi.fn();
    renderHook(() => useWikiPulse("ws://a", onUnauthorized));
    act(() => FakeSocket.instances[0].closeFromServer(4401));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("ignores a late close from a socket it already replaced", () => {
    const { result, rerender } = renderHook(({ url }) => useWikiPulse(url), { initialProps: { url: "ws://a" } });
    const old = FakeSocket.instances[0];
    rerender({ url: "ws://b" }); // effect cleanup + new socket (same as StrictMode remount)
    const current = FakeSocket.instances[1];
    act(() => current.open());
    expect(result.current.state.connection).toBe("open");

    act(() => old.closeFromServer()); // arrives late
    expect(result.current.state.connection).toBe("open");
    act(() => vi.advanceTimersByTime(20_000));
    expect(FakeSocket.instances).toHaveLength(2); // and it did not trigger a reconnect
  });

  it("reconnects with backoff and re-sends the wiki filter", () => {
    const { result } = renderHook(() => useWikiPulse("ws://a"));
    act(() => FakeSocket.instances[0].open());
    act(() => result.current.setWiki("frwiki"));

    act(() => FakeSocket.instances[0].closeFromServer());
    expect(result.current.state.connection).toBe("closed");
    act(() => vi.advanceTimersByTime(1_000));
    const next = FakeSocket.instances[1];
    act(() => next.open());
    expect(next.sent).toEqual([JSON.stringify({ type: "subscribe", wiki: "frwiki" })]);
  });

  describe("paused feed", () => {
    const hello = JSON.stringify({
      type: "hello",
      source: { source: "live", connected: true },
      ai: { enabled: false, model: null },
      recent: [{ id: "a" }],
      flagged: [],
      snapshot: null,
      pulse: null,
    });
    const edits = (...ids: string[]) => JSON.stringify({ type: "edits", items: ids.map((id) => ({ id })) });

    function connected(refreshMs = 1_000) {
      const hook = renderHook(() => useWikiPulse("ws://a", undefined, refreshMs));
      const socket = FakeSocket.instances[0];
      act(() => socket.open());
      act(() => socket.onmessage?.({ data: hello }));
      return { ...hook, socket };
    }
    const feed = (r: { current: ReturnType<typeof useWikiPulse> }) => r.current.state.edits.map((e) => e.id);

    it("starts paused and catches up on its own every interval", () => {
      const { result, socket } = connected();
      expect(result.current.state.paused).toBe(true);
      act(() => socket.onmessage?.({ data: edits("b") }));
      expect(feed(result)).toEqual(["a"]);

      act(() => vi.advanceTimersByTime(999));
      expect(feed(result)).toEqual(["a"]);
      act(() => vi.advanceTimersByTime(1));
      expect(feed(result)).toEqual(["b", "a"]);
      expect(result.current.state.paused).toBe(true);
      expect(result.current.nextFeedUpdate).not.toBeNull();
    });

    it("shows waiting edits at once on request and restarts the countdown", () => {
      const { result, socket } = connected();
      act(() => vi.advanceTimersByTime(600));
      act(() => socket.onmessage?.({ data: edits("b") }));
      act(() => result.current.refreshFeed());
      expect(feed(result)).toEqual(["b", "a"]);

      act(() => socket.onmessage?.({ data: edits("c") }));
      act(() => vi.advanceTimersByTime(600)); // the old timer would have fired here
      expect(feed(result)).toEqual(["b", "a"]);
      act(() => vi.advanceTimersByTime(400));
      expect(feed(result)).toEqual(["c", "b", "a"]);
    });

    it("stops the timer when the feed goes live", () => {
      const { result } = connected();
      act(() => result.current.togglePause());
      expect(result.current.state.paused).toBe(false);
      expect(result.current.nextFeedUpdate).toBeNull();
    });
  });
});
