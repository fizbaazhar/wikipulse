import { defineConfig } from "cypress";

// The E2E tests run against the real back end (replaying the recorded sample,
// AI off) and the real dashboard. `npm run e2e` starts both on ports that
// differ from the dev defaults, so the tests can run next to a dev session:
// back end on 8001, dashboard on 5174 (see the e2e:* scripts in package.json).
// The back end's rolling window is one hour there, so the replayed sample
// stays on screen for a long run or an open Cypress window.
export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5174",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10_000,
    video: false,
    screenshotOnRunFailure: true,
  },
});
