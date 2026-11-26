import { defineConfig, devices } from "@playwright/test";

// The E2E test runs the real back end (replaying the recorded sample, AI off)
// and the real dashboard, then drives a real browser. Ports differ from the
// dev defaults so it can run next to a dev session.
const BACKEND_PORT = 8001;
const FRONTEND_PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `../backend/.venv/bin/uvicorn --factory app.main:create_app --app-dir ../backend --port ${BACKEND_PORT}`,
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      env: {
        WIKIPULSE_SOURCE: "replay",
        WIKIPULSE_REPLAY_SPEED: "0", // load the whole sample at once: deterministic
        WIKIPULSE_REPLAY_LOOP: "false",
        WIKIPULSE_AI: "off",
        WIKIPULSE_PULSE_INTERVAL: "1",
        // Login on, with a throwaway account (overrides anything in backend/.env).
        WIKIPULSE_AUTH_USERNAME: "e2e",
        WIKIPULSE_AUTH_PASSWORD: "e2e-password",
        WIKIPULSE_SESSION_SECRET: "e2e-only-secret",
      },
      reuseExistingServer: false,
    },
    {
      command: "npx vite",
      url: `http://localhost:${FRONTEND_PORT}`,
      env: { PORT: String(FRONTEND_PORT), WIKIPULSE_BACKEND_URL: `http://localhost:${BACKEND_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
