// `npm run e2e` starts the back end with this throwaway account.
export const USER = "e2e";
export const PASSWORD = "e2e-password";
const TOUR_SEEN_KEY = "wikipulse-tour-done-v1";

/** Open a page. The guided tour opens on a first visit; by default mark it seen so it doesn't cover the page. */
export function visitApp(path = "/", { tourSeen = true } = {}) {
  cy.visit(path, {
    onBeforeLoad(win) {
      if (tourSeen) win.localStorage.setItem(TOUR_SEEN_KEY, "1");
    },
  });
}

export function signIn(password = PASSWORD, user = USER) {
  cy.findByLabelText("Username").clear().type(user);
  cy.findByLabelText("Password").clear().type(password, { log: false });
  cy.findByRole("button", { name: "Sign in" }).click();
}

/** Signed in, tour seen, the recorded sample on screen. */
export function openDashboard() {
  visitApp();
  signIn();
  feedLoaded();
}

export function feedLoaded() {
  cy.get(".feed-item").first().should("be.visible");
}

/** Fail the test if anything calls alert(): that would mean an XSS payload from the stream executed. */
export function failOnAlert() {
  cy.on("window:alert", (message) => {
    throw new Error(`Unexpected alert: ${message}`);
  });
}
