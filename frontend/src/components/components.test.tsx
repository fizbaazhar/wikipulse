import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeEdit, makeFlag, makeSnapshot } from "../test/fixtures";
import { FlaggedEdits } from "./FlaggedEdits";
import { Header } from "./Header";
import { LiveFeed } from "./LiveFeed";
import { TopPages } from "./TopPages";

describe("LiveFeed", () => {
  it("shows hostile edit summaries as plain text, never as HTML", () => {
    const payload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const { container } = render(
      <LiveFeed edits={[makeEdit({ comment: payload })]} paused={false} pendingCount={0} onTogglePause={() => {}} />,
    );
    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("never renders a javascript: link", () => {
    render(
      <LiveFeed
        edits={[makeEdit({ url: "javascript:alert(1)", diff_url: null })]}
        paused={false}
        pendingCount={0}
        onTogglePause={() => {}}
      />,
    );
    expect(screen.getByText("Mars").closest("a")).not.toHaveAttribute("href");
  });

  it("shows flag badges, and while paused: the next update, show-now and Go live", async () => {
    const onToggle = vi.fn();
    const onRefresh = vi.fn();
    render(
      <LiveFeed
        edits={[makeEdit({ flag: makeFlag({ status: "reviewing" }) })]}
        paused
        pendingCount={7}
        onTogglePause={onToggle}
        onRefresh={onRefresh}
        nextUpdate={Date.now() + 83_000}
      />,
    );
    expect(screen.getByText("AI reviewing…")).toBeInTheDocument();
    const next = document.querySelector(".feed-next");
    expect(next?.textContent).toMatch(/^Updates every 2 min · next in 1:2\d$/);
    await userEvent.click(screen.getByRole("button", { name: "7 new" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("offers Pause while live", () => {
    render(<LiveFeed edits={[makeEdit()]} paused={false} pendingCount={0} onTogglePause={() => {}} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(document.querySelector(".feed-next")).toBeNull();
  });

  it("does not stay held after the list disappears under the pointer", () => {
    const props = { paused: false, pendingCount: 0, onTogglePause: () => {} };
    const { container, rerender } = render(<LiveFeed edits={[makeEdit()]} feedVersion={1} {...props} />);
    const card = container.querySelector("section")!;
    fireEvent.pointerEnter(card, { pointerType: "mouse" });
    expect(screen.getByText("Held while you read")).toBeInTheDocument();

    rerender(<LiveFeed edits={[]} feedVersion={2} {...props} />); // quiet wiki: list unmounts
    fireEvent.pointerLeave(card, { pointerType: "mouse" });
    rerender(<LiveFeed edits={[makeEdit({ id: "b" })]} feedVersion={3} {...props} />);
    expect(screen.queryByText("Held while you read")).toBeNull();
  });

  it("is not held by a tap on a touch screen", () => {
    const props = { paused: false, pendingCount: 0, onTogglePause: () => {} };
    const { container } = render(<LiveFeed edits={[makeEdit()]} feedVersion={1} {...props} />);
    fireEvent.pointerEnter(container.querySelector("section")!, { pointerType: "touch" });
    expect(screen.queryByText("Held while you read")).toBeNull();
  });

  it("stops adding rows the moment it is paused, then catches up on resume", () => {
    vi.useFakeTimers();
    try {
      const props = { feedVersion: 1, pendingCount: 0, onTogglePause: () => {} };
      const first = makeEdit({ id: "a", title: "First" });
      const queued = [makeEdit({ id: "c", title: "Third" }), makeEdit({ id: "b", title: "Second" })];
      const { rerender } = render(<LiveFeed edits={[first]} paused={false} {...props} />);
      // A batch arrives and is queued to trickle in, then the user pauses.
      rerender(<LiveFeed edits={[...queued, first]} paused={false} {...props} />);
      rerender(<LiveFeed edits={[...queued, first]} paused {...props} />);
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByText("Second")).toBeNull();
      expect(screen.queryByText("Third")).toBeNull();

      rerender(<LiveFeed edits={[...queued, first]} paused={false} {...props} />);
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByText("Second")).toBeInTheDocument();
      expect(screen.getByText("Third")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FlaggedEdits", () => {
  it("explains why an edit was flagged and who decided", () => {
    render(
      <FlaggedEdits
        edits={[makeEdit({ flag: makeFlag({ source: "ai", reason: "Page was blanked", ai_confidence: 0.92 }) })]}
        ai={{ enabled: true, model: "m" }}
      />,
    );
    expect(screen.getByText("Page was blanked")).toBeInTheDocument();
    expect(screen.getByText(/AI confidence 92%/)).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("shows the AI's quote from the edit as text, and nothing when there is none", () => {
    const quote = '<img src=x onerror="alert(1)"> nobody cares';
    const { container } = render(
      <FlaggedEdits
        edits={[
          makeEdit({ id: "q", flag: makeFlag({ source: "ai", evidence: quote }) }),
          makeEdit({ id: "n", flag: makeFlag({ source: "rules" }) }),
        ]}
        ai={{ enabled: true, model: "m" }}
      />,
    );
    const shown = container.querySelectorAll(".flagged-evidence");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveTextContent(`In the edit: “${quote}”`);
    expect(container.querySelector("img")).toBeNull();
  });

  it("puts open flags first and tucks cleared ones into a collapsed group", () => {
    const { container } = render(
      <FlaggedEdits
        edits={[
          makeEdit({ id: "c", title: "Cleared page", flag: makeFlag({ status: "cleared" }) }),
          makeEdit({ id: "s", title: "Suspect page", flag: makeFlag({ status: "suspect" }) }),
          makeEdit({ id: "f", title: "Flagged page", flag: makeFlag({ status: "flagged" }) }),
        ]}
        ai={{ enabled: true, model: "m" }}
      />,
    );
    const open = [...container.querySelectorAll(".flagged-open .flagged-title")].map((a) => a.textContent);
    expect(open).toEqual(["Flagged page", "Suspect page"]);
    const group = container.querySelector("details.flagged-cleared-group")!;
    expect(group).not.toHaveAttribute("open");
    expect(within(group as HTMLElement).getByText("Cleared page")).toBeInTheDocument();
    expect(screen.getByLabelText("Flag counts")).toHaveTextContent("1 likely1 suspicious1 cleared");
  });
});

describe("Header", () => {
  it("lists wikis with readable names and reports changes", async () => {
    const onChange = vi.fn();
    render(
      <Header
        connection="open"
        source={{ source: "live", connected: true }}
        wiki={null}
        wikis={makeSnapshot().wikis}
        onWikiChange={onChange}
        theme="light"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Live");
    const select = screen.getByLabelText("Filter by wiki");
    expect(within(select).getByRole("option", { name: "French (frwiki)" })).toBeInTheDocument();

    await userEvent.selectOptions(select, "frwiki");
    expect(onChange).toHaveBeenLastCalledWith("frwiki");
    await userEvent.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps the wiki list still while the menu is open, even as rankings change", () => {
    const props = {
      connection: "open" as const,
      source: null,
      wiki: null,
      onWikiChange: vi.fn(),
      theme: "light" as const,
    };
    const before = [
      { wiki: "enwiki", count: 9 },
      { wiki: "dewiki", count: 5 },
    ];
    const after = [
      { wiki: "frwiki", count: 20 },
      { wiki: "dewiki", count: 7 },
      { wiki: "enwiki", count: 6 },
    ];
    const { rerender } = render(<Header {...props} wikis={before} />);
    const select = screen.getByLabelText("Filter by wiki");
    const values = () => within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);

    fireEvent.focus(select);
    rerender(<Header {...props} wikis={after} />);
    expect(values()).toEqual(["", "enwiki", "dewiki"]);

    fireEvent.blur(select);
    expect(values()).toEqual(["", "frwiki", "dewiki", "enwiki"]);
  });
});

describe("TopPages", () => {
  it("ranks pages with counts", () => {
    render(<TopPages pages={makeSnapshot().top_pages} windowSeconds={300} />);
    expect(screen.getByText("Most edited · last 5 min")).toBeInTheDocument();
    expect(screen.getByText("Mars").closest("a")).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Mars");
    expect(screen.getByText("9")).toBeInTheDocument();
  });
});

describe("Loading placeholders", () => {
  const ai = { enabled: false, model: null };

  it("show while the first data is on its way, instead of empty-state text", () => {
    render(
      <>
        <TopPages pages={[]} windowSeconds={300} loading />
        <FlaggedEdits edits={[]} ai={ai} loading />
      </>,
    );
    expect(screen.getByRole("status", { name: "Loading most edited pages" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading flagged edits" })).toBeInTheDocument();
    expect(screen.queryByText("No edits yet.")).toBeNull();
    expect(screen.queryByText("Nothing suspicious so far.")).toBeNull();
  });

  it("give way to the real empty states once data has arrived", () => {
    render(
      <>
        <TopPages pages={[]} windowSeconds={300} />
        <FlaggedEdits edits={[]} ai={ai} />
      </>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("No edits yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing suspicious so far.")).toBeInTheDocument();
  });

  it("stand in for an empty live feed", () => {
    render(<LiveFeed edits={[]} paused pendingCount={0} onTogglePause={() => {}} />);
    expect(screen.getByRole("status", { name: "Loading edits" })).toBeInTheDocument();
  });
});
