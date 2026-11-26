import { failOnAlert, openDashboard } from "../support/helpers";

// The e2e back end runs with AI off, so every answer comes from the rules.
function ask(question: string) {
  cy.findByLabelText("Ask a question").type(`${question}{enter}`);
}

function lastAnswer() {
  return cy.get(".assistant-msg-assistant").last();
}

describe("Dashboard assistant", () => {
  beforeEach(() => {
    failOnAlert();
    openDashboard();
    cy.findByRole("button", { name: "Ask the AI assistant" }).click();
  });

  it("opens with suggestions and answers one from the live data", () => {
    cy.findByRole("dialog", { name: "AI assistant" }).within(() => {
      cy.contains("AI off").should("be.visible");
      cy.get(".assistant-chip").should("have.length", 4);
      cy.findByRole("button", { name: "How much of the editing is by bots?" }).click();
    });
    cy.get(".assistant-msg-user").should("contain.text", "How much of the editing is by bots?");
    lastAnswer().should("contain.text", "were made by bots");
  });

  it("explains a panel and declines questions about anything else", () => {
    ask("What is the live heartbeat?");
    lastAnswer().should("contain.text", "edits per second");

    ask("What is the capital of France?");
    lastAnswer().should("contain.text", "I can only answer questions about the WikiPulse dashboard");
    cy.get(".assistant-msg-user").should("have.length", 2);
  });

  it("shows a question with HTML as text", () => {
    ask('<img src=x onerror="alert(1)"> what is trending?');
    cy.get(".assistant-msg-user").should("contain.text", "<img src=x");
    cy.get(".assistant img").should("not.exist");
    lastAnswer().invoke("text").should("not.be.empty");
  });

  it("clears the chat and closes with the button, the ✕ or Escape", () => {
    ask("Which wikis are busiest?");
    lastAnswer().invoke("text").should("not.be.empty");
    cy.findByRole("button", { name: "Clear" }).click();
    cy.get(".assistant-msg").should("not.exist");
    cy.get(".assistant-chip").should("have.length", 4);

    cy.findByRole("button", { name: "Close" }).click();
    cy.findByRole("dialog", { name: "AI assistant" }).should("not.exist");

    cy.findByRole("button", { name: "Ask the AI assistant" }).click();
    cy.findByLabelText("Ask a question").type("{esc}");
    cy.findByRole("dialog", { name: "AI assistant" }).should("not.exist");
    cy.findByRole("button", { name: "Ask the AI assistant" }).should("have.focus");

    cy.findByRole("button", { name: "Ask the AI assistant" }).click();
    cy.findByRole("button", { name: "Close AI assistant" }).click();
    cy.findByRole("dialog", { name: "AI assistant" }).should("not.exist");
  });

  it("follows the wiki filter", () => {
    cy.findByRole("button", { name: "Close" }).click();
    cy.findByLabelText("Filter by wiki").select("frwiki");
    cy.findByRole("button", { name: "Ask the AI assistant" }).click();
    cy.findByRole("dialog", { name: "AI assistant" }).should("contain.text", "French");
  });
});
