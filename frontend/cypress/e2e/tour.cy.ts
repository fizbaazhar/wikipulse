import { feedLoaded, signIn, visitApp } from "../support/helpers";

/** Press Next until the last step, whatever the number of steps. */
function nextUntilFinish() {
  cy.findByRole("dialog").then(($tour) => {
    const finish = $tour.find("button").filter((_, el) => el.textContent?.trim() === "Finish");
    if (finish.length) return;
    cy.wrap($tour).findByRole("button", { name: "Next" }).click();
    nextUntilFinish();
  });
}

describe("Guided tour", () => {
  it("opens on the first visit, walks every section and can be replayed", () => {
    visitApp("/", { tourSeen: false });
    signIn();

    cy.findByRole("dialog").within(() => {
      cy.findByRole("heading", { name: /Welcome to WikiPulse/ }).should("be.visible");
      cy.findByRole("button", { name: "Start tour" }).click();
      cy.findByRole("heading", { name: "Connection status" }).should("be.visible");
    });
    cy.get("body").type("{rightArrow}");
    cy.findByRole("dialog").within(() => {
      cy.findByRole("heading", { name: "Key numbers" }).should("be.visible");
      cy.findByRole("button", { name: "Back" }).click();
      cy.findByRole("heading", { name: "Connection status" }).should("be.visible");
    });

    nextUntilFinish();
    cy.findByRole("dialog").within(() => {
      cy.findByRole("heading", { name: "That's it!" }).should("be.visible");
      cy.findByRole("button", { name: "Finish" }).click();
    });
    cy.findByRole("dialog").should("not.exist");

    // Seen once: a reload doesn't reopen it, but the ? button does.
    cy.reload();
    feedLoaded();
    cy.findByRole("dialog").should("not.exist");
    cy.findByRole("button", { name: "Take the tour" }).click();
    cy.findByRole("dialog").should("be.visible");
    cy.get("body").type("{esc}");
    cy.findByRole("dialog").should("not.exist");
  });
});
