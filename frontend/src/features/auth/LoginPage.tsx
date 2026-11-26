import { useState, type FormEvent } from "react";
import { BrandMark } from "../../components/BrandMark";
import { ThemeToggle } from "../../components/ThemeToggle";
import type { Theme } from "../../hooks/useTheme";

interface Props {
  /** Resolves to an error message, or null when signed in. */
  onLogin: (username: string, password: string) => Promise<string | null>;
  /** Shown above the form, e.g. "Your session ended". */
  notice?: string;
  theme: Theme;
  onToggleTheme: () => void;
}

const FEATURES = [
  "Every edit across 300+ Wikipedias, live",
  "Trending pages and busiest wikis at a glance",
  "AI summaries and vandalism flags with reasons",
];

export function LoginPage({ onLogin, notice, theme, onToggleTheme }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onLogin(username.trim(), password);
    // On success this component unmounts; only update state on failure.
    if (message) {
      setError(message);
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login-brand">
        <div className="login-brand-top">
          <BrandMark />
          <span className="login-brand-name">WikiPulse</span>
        </div>
        <div>
          <h2 className="login-tagline">See Wikipedia change, as it happens.</h2>
          <ul className="login-features">
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
        <svg className="login-wave" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 50 L60 50 L80 20 L100 70 L120 40 L160 40 L180 10 L200 75 L220 45 L280 45 L300 30 L320 60 L340 45 L400 45" />
        </svg>
      </aside>

      <main className="login-main">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} className="login-theme" />

        <form className="login-card" onSubmit={submit} noValidate aria-labelledby="login-title">
          <div className="login-card-brand">
            <BrandMark />
            <span className="login-brand-name">WikiPulse</span>
          </div>
          <h1 id="login-title">Hello! Let's get started</h1>
          <p className="muted">Sign in to continue to the live dashboard.</p>

          {notice && !error && (
            <p className="login-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <div className="field">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Password</label>
            <div className="field-password">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
              <button
                type="button"
                className="field-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
