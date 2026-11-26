import { PASSWORD, feedLoaded, signIn, visitApp } from "../support/helpers";

describe("Login and session", () => {
  it("keeps the dashboard and the API closed without a session", () => {
    visitApp("/dashboard");
    cy.location("pathname").should("eq", "/login");
    cy.findByRole("heading", { name: "Hello! Let's get started" }).should("be.visible");

    for (const url of ["/api/snapshot", "/api/recent", "/api/flagged", "/api/pulse"]) {
      cy.request({ url, failOnStatusCode: false }).its("status").should("eq", 401);
    }
    // Health stays open for monitoring.
    cy.request("/api/health").its("status").should("eq", 200);
  });

  it("asks for both fields before calling the server", () => {
    visitApp();
    cy.findByRole("button", { name: "Sign in" }).click();
    cy.findByRole("alert").should("have.text", "Enter your username and password.");
  });

  it("shows and hides the password", () => {
    visitApp();
    cy.findByLabelText("Password").type("secret").should("have.attr", "type", "password");
    cy.findByRole("button", { name: "Show password" }).click();
    cy.findByLabelText("Password").should("have.attr", "type", "text");
    cy.findByRole("button", { name: "Hide password" }).click();
    cy.findByLabelText("Password").should("have.attr", "type", "password");
  });

  it("rejects a wrong password, then signs in, survives a reload and signs out", () => {
    visitApp();
    signIn("wrong");
    cy.findByRole("alert").should("have.text", "Wrong username or password.");
    cy.location("pathname").should("eq", "/login");

    signIn();
    feedLoaded();
    cy.location("pathname").should("eq", "/dashboard");
    cy.findByRole("button", { name: "Account: e2e" }).should("be.visible");
    cy.reload(); // the session cookie survives a reload
    feedLoaded();
    cy.location("pathname").should("eq", "/dashboard");
    cy.request("/api/snapshot").its("status").should("eq", 200);

    cy.findByRole("button", { name: /^Account:/ }).click();
    cy.findByRole("button", { name: "Sign out" }).click();
    cy.findByRole("button", { name: "Sign in" }).should("be.visible");
    cy.location("pathname").should("eq", "/login");
    // Signing out clears the session cookie, so the API is closed again. (Sessions
    // are stateless signed tokens: a copied token stays valid until it expires.)
    cy.request({ url: "/api/snapshot", failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("closes the account menu with Escape and on an outside click", () => {
    visitApp();
    signIn();
    feedLoaded();
    cy.findByRole("button", { name: /^Account:/ }).click();
    cy.findByRole("button", { name: "Sign out" }).should("be.visible");
    cy.get("body").type("{esc}");
    cy.findByRole("button", { name: "Sign out" }).should("not.exist");
    cy.findByRole("button", { name: /^Account:/ }).should("have.focus").click();
    cy.findByRole("button", { name: "Sign out" }).should("be.visible");
    cy.get(".pulse-headline").trigger("pointerdown");
    cy.findByRole("button", { name: "Sign out" }).should("not.exist");
  });

  it("explains a rate-limited or unreachable server", () => {
    visitApp();
    cy.intercept("POST", "/api/auth/login", { statusCode: 429, body: { detail: "Too many attempts." } });
    signIn();
    cy.findByRole("alert").should("have.text", "Too many attempts. Please wait a few minutes and try again.");

    cy.intercept("POST", "/api/auth/login", { forceNetworkError: true });
    signIn(PASSWORD);
    cy.findByRole("alert").should("contain.text", "Can't reach the server");
  });

  it("switches the theme on the login page", () => {
    visitApp();
    cy.get("html").should("have.attr", "data-theme", "light");
    cy.findByRole("button", { name: "Switch to dark theme" }).click();
    cy.get("html").should("have.attr", "data-theme", "dark");
    cy.findByRole("button", { name: "Switch to light theme" }).click();
    cy.get("html").should("have.attr", "data-theme", "light");
  });
});
