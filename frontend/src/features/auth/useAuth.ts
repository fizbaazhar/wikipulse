import { useCallback, useEffect, useState } from "react";

/**
 * - checking: asking the server who we are
 * - signed-out: login is required and we have no session
 * - signed-in: we have a session for `user`
 * - open: the server has login turned off (no password configured)
 */
type AuthState =
  | { status: "checking" }
  | { status: "signed-out"; reason?: string }
  | { status: "signed-in"; user: string }
  | { status: "open" };

const UNREACHABLE = "Can't reach the server. Retrying…";
const RETRY_MS = 3_000;

interface MeResponse {
  auth_enabled: boolean;
  user: string | null;
}

/** Session state for the dashboard. The session itself is an HttpOnly cookie the page can't read. */
export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  // Ask the server who we are. If it can't be reached (e.g. it is
  // restarting), keep retrying quietly and clear the message once it answers.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const response = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const me = (await response.json()) as MeResponse;
        if (stopped) return;
        setAuth((current) =>
          !me.auth_enabled
            ? { status: "open" }
            : me.user
              ? { status: "signed-in", user: me.user }
              : // keep a "session ended" notice, drop a stale "can't reach" one
                current.status === "signed-out" && current.reason !== UNREACHABLE
                ? current
                : { status: "signed-out" },
        );
      } catch {
        if (stopped) return;
        setAuth({ status: "signed-out", reason: UNREACHABLE });
        timer = setTimeout(check, RETRY_MS);
      }
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  /** Returns an error message, or null on success. */
  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        const me = (await response.json()) as MeResponse;
        setAuth(me.user ? { status: "signed-in", user: me.user } : { status: "open" });
        return null;
      }
      if (response.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
      if (response.status === 401) return "Wrong username or password.";
      if (response.status === 422) return "Enter your username and password.";
      return "Sign-in failed. Please try again.";
    } catch {
      return "Can't reach the server. Check that the back end is running, then try again.";
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      // Server unreachable: still sign out on this side.
    }
    setAuth({ status: "signed-out" });
  }, []);

  /** The server rejected our session (expired, or the server restarted). */
  const expired = useCallback(() => {
    setAuth((current) =>
      current.status === "signed-in" ? { status: "signed-out", reason: "Your session ended. Please sign in again." } : current,
    );
  }, []);

  return { auth, login, logout, expired };
}
