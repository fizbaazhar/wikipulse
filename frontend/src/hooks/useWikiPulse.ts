import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { initialState, reducer } from "../state/dashboard";
import type { Pulse, ServerMessage } from "../types";
import { useLatest } from "./useLatest";

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;
/** Close code the server uses when the session is missing or expired. */
const WS_UNAUTHORIZED = 4401;
/** How often a paused feed catches up on its own. */
export const FEED_REFRESH_MS = 120_000;

/** WebSocket URL: same origin by default (Vite proxy in dev, nginx in Docker). */
function defaultSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws`;
}

/**
 * Connects to the back end, keeps the dashboard state up to date and
 * reconnects with exponential backoff. On reconnect it re-sends the current
 * wiki filter, and the server's "hello" replaces local state, so nothing is
 * lost or duplicated across a reconnect.
 */
export function useWikiPulse(
  url: string = defaultSocketUrl(),
  onUnauthorized?: () => void,
  feedRefreshMs: number = FEED_REFRESH_MS,
) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socket = useRef<WebSocket | null>(null);
  const wikiRef = useRef<string | null>(null);
  const unauthorizedRef = useLatest(onUnauthorized);

  useEffect(() => {
    let retry = MIN_RETRY_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let current: WebSocket | null = null;

    const connect = () => {
      dispatch({ type: "connection", status: "connecting" });
      const ws = new WebSocket(url);
      current = ws;
      socket.current = ws;
      // Events from a socket we already replaced or closed (StrictMode's
      // double mount, a URL change) must not touch the current state.
      const isCurrent = () => !stopped && current === ws;

      ws.onopen = () => {
        if (!isCurrent()) return;
        retry = MIN_RETRY_MS;
        dispatch({ type: "connection", status: "open" });
        if (wikiRef.current) {
          ws.send(JSON.stringify({ type: "subscribe", wiki: wikiRef.current }));
        }
      };
      ws.onmessage = (event) => {
        if (!isCurrent()) return;
        try {
          dispatch({ type: "message", message: JSON.parse(event.data as string) as ServerMessage });
        } catch {
          // Ignore a malformed frame rather than breaking the dashboard.
        }
      };
      ws.onclose = (event) => {
        if (!isCurrent()) return;
        dispatch({ type: "connection", status: "closed" });
        if (event.code === WS_UNAUTHORIZED) {
          unauthorizedRef.current?.(); // no point retrying without a session
          return;
        }
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, MAX_RETRY_MS);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      current?.close();
      if (socket.current === current) socket.current = null;
    };
  }, [url]);

  const setWiki = useCallback((wiki: string | null) => {
    wikiRef.current = wiki;
    dispatch({ type: "setWiki", wiki });
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "subscribe", wiki }));
    }
  }, []);

  const togglePause = useCallback(() => dispatch({ type: "togglePause" }), []);

  // While paused, the feed catches up on a timer. "Update now" restarts it.
  const [feedCycle, setFeedCycle] = useState(0);
  const [nextFeedUpdate, setNextFeedUpdate] = useState<number | null>(null);
  useEffect(() => {
    if (!state.paused) {
      setNextFeedUpdate(null);
      return;
    }
    setNextFeedUpdate(Date.now() + feedRefreshMs);
    const id = setInterval(() => {
      dispatch({ type: "refreshFeed" });
      setNextFeedUpdate(Date.now() + feedRefreshMs);
    }, feedRefreshMs);
    return () => clearInterval(id);
  }, [state.paused, feedCycle, feedRefreshMs]);
  const refreshFeed = useCallback(() => {
    dispatch({ type: "refreshFeed" });
    setFeedCycle((n) => n + 1);
  }, []);

  const refreshPulse = useCallback(async () => {
    const response = await fetch("/api/pulse/refresh", { method: "POST", credentials: "same-origin" });
    if (response.status === 401) unauthorizedRef.current?.();
    if (!response.ok) throw new Error(`refresh failed: ${response.status}`);
    const body = (await response.json()) as { refreshed: boolean; pulse: Pulse };
    dispatch({ type: "message", message: { type: "pulse", data: body.pulse } });
    return body.refreshed;
  }, []);

  return { state, setWiki, togglePause, refreshFeed, nextFeedUpdate, refreshPulse };
}
