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
});
