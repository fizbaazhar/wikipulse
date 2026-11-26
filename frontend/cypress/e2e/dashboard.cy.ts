import { failOnAlert, openDashboard } from "../support/helpers";

// The back end replays the recorded sample once, all at once, with AI off, so
// the numbers on screen are the same on every run.
describe("WikiPulse dashboard (replaying the recorded sample)", () => {
  beforeEach(() => {
    failOnAlert();
    openDashboard();
  });

  it("shows the header: connection status and key numbers", () => {
    cy.findByRole("heading", { name: "WikiPulse" }).should("be.visible");
    cy.findByRole("status").should("contain.text", "Replay");
    cy.findByLabelText("Key numbers").within(() => {
      // The e2e back end uses a one-hour window (see e2e:backend), so "Last 60 min".
      for (const label of ["Edits / min", /^Last \d+ min$/, "By bots", "Wikis active", "Flagged"]) {
        cy.contains(label).should("be.visible");
      }
    });
    cy.get(".kpi-alert").should("be.visible"); // the sample has flagged edits
  });

  it("shows the Pulse summary and can refresh it", () => {
    cy.get(".pulse").within(() => {
      cy.contains("Rule-based summary").should("be.visible");
      cy.get(".pulse-headline").should("contain.text", "Artificial intelligence");
      cy.get(".pulse-summary").invoke("text").should("have.length.greaterThan", 40);
      cy.findByRole("button", { name: "Refresh" }).click();
      cy.findByRole("button", { name: "Refresh" }).should("be.enabled");
      cy.get(".pulse-headline").should("contain.text", "Artificial intelligence");
    });
  });

  it("lists the 10 most-edited pages with safe links", () => {
    cy.get(".top-pages .top-item").should("have.length", 10);
    cy.get(".top-pages .top-item").first().should("contain.text", "Artificial intelligence");
    cy.get(".top-pages .top-count").then(($counts) => {
      const counts = [...$counts].map((el) => Number(el.textContent));
      expect(counts).to.deep.equal([...counts].sort((a, b) => b - a)); // ranked high to low
    });
    cy.get(".top-pages .sparkline").should("have.length", 10);
    cy.get(".top-pages .top-title").each(($a) => {
      expect($a.attr("href")).to.match(/^https:\/\//);
      expect($a.attr("target")).to.equal("_blank");
      expect($a.attr("rel")).to.contain("noopener");
    });
  });

  it("shows the feed paused, can go live and pause again", () => {
    cy.get(".feed-item").its("length").should("be.greaterThan", 50);
    cy.get(".feed-item").first().within(() => {
      cy.get(".feed-time").invoke("text").should("match", /^\d{2}:\d{2}:\d{2}$/);
      cy.get(".feed-title").should("have.attr", "target", "_blank").and("have.attr", "href").and("match", /^https:\/\//);
    });
    // Paused by default, with the countdown to the next catch-up.
    cy.get(".feed-next").should("be.visible").invoke("text").should("match", /^Updates every 2 min · next in [0-2]:\d\d$/);
    cy.findByRole("button", { name: "Go live" }).click();
    cy.get(".feed-next").should("not.exist");
    cy.findByRole("button", { name: "Pause" }).click();
    cy.findByRole("button", { name: "Go live" }).should("be.visible");
  });

  it("draws every chart, with a hover tooltip and a screen-reader table", () => {
    cy.get(".heartbeat path.line").should("exist");
    cy.findByRole("img", { name: /^Edits per second, now/ }).should("exist");
    cy.findByRole("img", { name: "Edits per minute by wiki over the last 30 minutes" }).should("exist");
    cy.findByRole("img", { name: "Distribution of edit sizes" }).should("exist");
    cy.get(".chart .bar").should("exist");
    cy.get(".sizes .bar").should("exist");
    cy.get(".editors .segbar-part").first().should("be.visible");

    // Hover shows the exact numbers.
    cy.get(".sizes rect[fill='transparent']").eq(3).trigger("pointerover");
    cy.get(".chart-tooltip").should("be.visible").and("contain.text", "edits");

    // The time and size charts also put their numbers in a visually hidden
    // table; the editor mix bar reads them out in its label.
    cy.get(".sr-only table caption").should("have.length", 3);
    cy.get(".editors [role='img']").should("have.attr", "aria-label").and("match", /\d+%/);
    cy.get(".sr-only table").each(($table) => {
      expect($table.find("tbody tr").length).to.be.greaterThan(0);
    });
  });

  it("flags the planted attacks and renders them as harmless text", () => {
    cy.findByLabelText("Flag counts").invoke("text").should("match", /\d+ likely\s*\d+ suspicious\s*\d+ cleared/i);
    cy.get(".flagged").contains("rules only").should("be.visible");
    cy.get(".flagged").contains("edit summary contains instructions aimed at automated moderation").should("be.visible");
    cy.get(".flagged").contains("edit summary contains HTML/script code").should("be.visible");
    cy.get(".flagged-item .flagged-reason").first().invoke("text").should("not.be.empty");

    // The raw payload is visible as text...
    cy.get(".flagged").contains('<script>alert("xss")</script>').should("be.visible");
    // ...and nothing from it was injected into the page.
    cy.get("img[src='x']").should("not.exist");
    cy.get(".flagged script").should("not.exist");
  });

  it("filters everything by wiki", () => {
    cy.findByLabelText("Filter by wiki").select("frwiki");

    cy.get(".feed-item").first().should("have.attr", "data-wiki", "frwiki");
    cy.get(".feed-item").should(($items) => {
      const wikis = new Set([...$items].map((el) => el.getAttribute("data-wiki")));
      expect([...wikis]).to.deep.equal(["frwiki"]);
    });
    cy.get(".top-pages .wiki-tag").each(($tag) => expect($tag.text()).to.equal("French"));

    cy.findByLabelText("Filter by wiki").select("");
    cy.get(".feed-item").should(($items) => {
      const wikis = new Set([...$items].map((el) => el.getAttribute("data-wiki")));
      expect(wikis.size).to.be.greaterThan(1);
    });
  });

  it("clicking a busy wiki filters the whole dashboard", () => {
    cy.get(".wikis").findByRole("button", { name: /French/ }).click();
    cy.findByLabelText("Filter by wiki").should("have.value", "frwiki");
    cy.get(".feed-item").first().should("have.attr", "data-wiki", "frwiki");
    cy.get(".wikis").findByRole("button", { name: /French/ }).should("have.attr", "aria-pressed", "true");

    cy.get(".wikis").findByRole("button", { name: "Show all" }).click();
    cy.findByLabelText("Filter by wiki").should("have.value", "");
  });

  it("remembers the dark theme across a reload", () => {
    cy.findByRole("button", { name: "Switch to dark theme" }).click();
    cy.get("html").should("have.attr", "data-theme", "dark");
    cy.reload();
    cy.get("html").should("have.attr", "data-theme", "dark");
    cy.findByRole("button", { name: "Switch to light theme" }).click();
    cy.get("html").should("have.attr", "data-theme", "light");
  });
});

describe("On a phone-sized screen", () => {
  beforeEach(() => {
    cy.viewport(390, 844);
    openDashboard();
  });

  it("fits the width and keeps every panel reachable", () => {
    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth);
    });
    for (const panel of [".pulse", ".top-pages", ".flagged", ".wikis"]) {
      cy.get(panel).scrollIntoView().should("be.visible");
    }
    cy.findByLabelText("Filter by wiki").should("be.visible");
    cy.findByRole("button", { name: "Ask the AI assistant" }).should("be.visible");
  });
});
