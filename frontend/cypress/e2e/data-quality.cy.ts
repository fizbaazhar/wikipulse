import { openDashboard } from "../support/helpers";

// The recorded sample from the brief has known problems: a broken JSON line,
// events that are not page edits (log, categorize), events with no title and
// repeated events. This spec reads the same file the back end replays, works
// out on its own what should survive, and checks the dashboard agrees.
const SAMPLE = "../backend/data/sample_events.jsonl";
const PAGE_EDITS = new Set(["edit", "new"]);

interface Expected {
  received: number;
  malformed: number;
  ignoredType: number;
  missingTitle: number;
  duplicates: number;
  accepted: number;
  /** Id of every edit that should reach the dashboard. */
  validIds: Set<string>;
  /** Id of every event that must never reach it (wrong type, no title). */
  rejectedIds: Set<string>;
  /** Events with no `meta` block: still valid, identified by their wiki and recent-changes id. */
  withoutMeta: Set<string>;
}

interface RawEvent {
  type?: string;
  title?: unknown;
  wiki?: string;
  id?: number;
  meta?: { id?: string } | null;
}

/** Same rule as the back end parser: meta.id, else "<wiki>:rc:<id>". */
function idOf(event: RawEvent): string | undefined {
  if (event.meta?.id) return event.meta.id;
  if (event.wiki && typeof event.id === "number") return `${event.wiki}:rc:${event.id}`;
  return undefined;
}

function analyse(text: string): Expected {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const e: Expected = {
    received: lines.length,
    malformed: 0,
    ignoredType: 0,
    missingTitle: 0,
    duplicates: 0,
    accepted: 0,
    validIds: new Set(),
    rejectedIds: new Set(),
    withoutMeta: new Set(),
  };
  for (const line of lines) {
    let event: RawEvent;
    try {
      event = JSON.parse(line);
    } catch {
      e.malformed += 1;
      continue;
    }
    const id = idOf(event);
    if (!event.meta?.id && id) e.withoutMeta.add(id);
    if (!PAGE_EDITS.has(event.type ?? "")) {
      e.ignoredType += 1;
      if (id) e.rejectedIds.add(id);
    } else if (typeof event.title !== "string" || event.title.trim() === "") {
      e.missingTitle += 1;
      if (id) e.rejectedIds.add(id);
    } else if (id && e.validIds.has(id)) {
      e.duplicates += 1;
    } else {
      e.accepted += 1;
      if (id) e.validIds.add(id);
    }
  }
  return e;
}

describe("Data quality: the problems in the recorded sample never reach the dashboard", () => {
  let expected: Expected;

  before(() => {
    cy.readFile(SAMPLE, "utf8").then((text: string) => {
      expected = analyse(text);
      // The sample really has each problem, so the checks below mean something.
      expect(expected.malformed, "broken JSON lines in the sample").to.be.greaterThan(0);
      expect(expected.ignoredType, "log/categorize events in the sample").to.be.greaterThan(0);
      expect(expected.missingTitle, "events without a title in the sample").to.be.greaterThan(0);
      expect(expected.duplicates, "repeated events in the sample").to.be.greaterThan(0);
      expect(expected.withoutMeta.size, "events without a meta block").to.be.greaterThan(0);
    });
  });

  beforeEach(() => {
    openDashboard();
  });

  it("the back end skips each kind of bad event and counts it", () => {
    cy.request("/api/health")
      .its("body.counters")
      .should((counters: Record<string, number>) => {
        expect(counters.received, "lines received").to.equal(expected.received);
        expect(counters.skipped_malformed_json, "broken JSON skipped").to.equal(expected.malformed);
        expect(counters.skipped_ignored_type, "log/categorize skipped").to.equal(expected.ignoredType);
        expect(counters.skipped_missing_title, "untitled skipped").to.equal(expected.missingTitle);
        expect(counters.duplicates, "repeats dropped").to.equal(expected.duplicates);
        expect(counters.accepted, "edits accepted").to.equal(expected.accepted);
        expect(counters.errors ?? 0, "unexpected parser errors").to.equal(0);
      });
  });

  it("the stats count every accepted edit exactly once", () => {
    cy.request("/api/snapshot").its("body.edits_in_window").should("equal", expected.accepted);
  });

  it("the feed shows each edit once and only real page edits", () => {
    cy.get(".feed-item").should(($items) => {
      const ids = [...$items].map((el) => el.getAttribute("data-id") ?? "");
      expect(ids.length).to.be.greaterThan(50);
      expect(new Set(ids).size, "no edit is shown twice").to.equal(ids.length);
      for (const id of ids) {
        expect(expected.validIds.has(id), `${id} is a valid edit from the sample`).to.equal(true);
        expect(expected.rejectedIds.has(id), `${id} was a rejected event`).to.equal(false);
      }
    });
    cy.get(".feed-item .feed-title").each(($title) => {
      expect($title.text().trim(), "every feed item has a title").not.to.equal("");
    });
  });

  it("the recent-edits API agrees: no repeats, no rejected events", () => {
    cy.request("/api/recent?limit=200")
      .its("body.items")
      .should((items: { id: string; type: string; title: string }[]) => {
        expect(items.length).to.be.greaterThan(50);
        expect(new Set(items.map((i) => i.id)).size, "no repeats").to.equal(items.length);
        for (const item of items) {
          expect(["edit", "new"], `${item.id} type`).to.include(item.type);
          expect(item.title.trim(), `${item.id} title`).not.to.equal("");
          expect(expected.rejectedIds.has(item.id), `${item.id} was rejected`).to.equal(false);
        }
      });
  });

  it("keeps a valid edit that arrived without its meta block", () => {
    cy.request("/api/recent?limit=200")
      .its("body.items")
      .should((items: { id: string }[]) => {
        const ids = new Set(items.map((i) => i.id));
        for (const id of expected.withoutMeta) {
          if (expected.validIds.has(id)) expect(ids.has(id), `${id} reached the dashboard`).to.equal(true);
        }
      });
  });

  it("a broken line in the stream doesn't break the page", () => {
    cy.get("header").findByRole("status").should("contain.text", "Replay");
    cy.findByRole("alert").should("not.exist");
    cy.get(".top-pages .top-item").should("have.length", 10);
  });
});
