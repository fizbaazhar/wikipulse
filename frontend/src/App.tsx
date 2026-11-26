import { useEffect } from "react";
import { Dashboard } from "./Dashboard";
import { LoginPage } from "./features/auth/LoginPage";
import { useAuth } from "./features/auth/useAuth";
import { useTheme } from "./hooks/useTheme";

export const LOGIN_PATH = "/login";
export const DASHBOARD_PATH = "/dashboard";

/**
 * Keeps the address bar in step with what is shown: /login when signed out,
 * /dashboard otherwise. replaceState, so Back never bounces between the two.
 */
function useRoutePath(path: string | null) {
  useEffect(() => {
    if (path && window.location.pathname !== path) {
      window.history.replaceState(null, "", path + window.location.search + window.location.hash);
    }
  }, [path]);
}

/** Login gate: the dashboard (and its WebSocket) only mounts with a session. */
export default function App() {
  const { theme, toggle } = useTheme();
  const { auth, login, logout, expired } = useAuth();
  useRoutePath(auth.status === "checking" ? null : auth.status === "signed-out" ? LOGIN_PATH : DASHBOARD_PATH);

  if (auth.status === "checking") {
    return (
      <div className="splash" role="status">
        <span className="splash-dot" aria-hidden="true" />
        Loading WikiPulse…
      </div>
    );
  }
  if (auth.status === "signed-out") {
    return <LoginPage onLogin={login} notice={auth.reason} theme={theme} onToggleTheme={toggle} />;
  }
  return (
    <Dashboard
      theme={theme}
      onToggleTheme={toggle}
      user={auth.status === "signed-in" ? auth.user : null}
      onLogout={auth.status === "signed-in" ? logout : undefined}
      onUnauthorized={expired}
    />
  );
}
