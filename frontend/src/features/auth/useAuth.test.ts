import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./useAuth";

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe("useAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries while the server is down and clears the message when it answers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(() => ok({ auth_enabled: true, user: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.auth).toMatchObject({ status: "signed-out", reason: expect.stringMatching(/Retrying/) }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(result.current.auth).toEqual({ status: "signed-out" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("signs out locally even when the server can't be reached", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => ok({ auth_enabled: true, user: "admin" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.auth).toEqual({ status: "signed-in", user: "admin" }));

    await act(() => result.current.logout());
    expect(result.current.auth).toEqual({ status: "signed-out" });
  });

  it("goes straight to the dashboard with an existing session", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok({ auth_enabled: true, user: "admin" })));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.auth).toEqual({ status: "signed-in", user: "admin" }));
  });
});
