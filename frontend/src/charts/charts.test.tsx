import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BusiestWikis } from "../components/BusiestWikis";
import { makeSnapshot } from "../test/fixtures";
import { EditorMix } from "./EditorMix";
import { EditSizeChart } from "./EditSizeChart";
import { EditsPerMinuteChart } from "./EditsPerMinuteChart";
import { LiveHeartbeat } from "./LiveHeartbeat";
import { useStableSlots } from "./colors";
import { formatTick, monotonePath, niceCeil, roundedTopRect } from "./geometry";
import { trendDirection } from "./Sparkline";

describe("geometry", () => {
  it("rounds axis maxima to clean numbers", () => {
    expect([0, 1, 7, 12, 260, 1_016].map(niceCeil)).toEqual([1, 1, 10, 20, 500, 2_000]);
  });

  it("formats ticks in full below 10,000 and compact above", () => {
    expect([0, 2_500, 20_000, 1_500_000].map(formatTick)).toEqual(["0", "2,500", "20K", "1.5M"]);
  });

  it("never overshoots: a flat run stays flat", () => {
    // Between two equal points the curve's control points keep the same y.
    const d = monotonePath([[0, 10], [10, 10], [20, 0]]);
    const firstSegment = d.split("C")[1].split(/[ ,]/).map(Number); // c1x,c1y c2x,c2y x,y
    expect([firstSegment[1], firstSegment[3], firstSegment[5]]).toEqual([10, 10, 10]);
  });

  it("draws nothing for an empty column", () => {
    expect(roundedTopRect(0, 0, 10, 0)).toBe("");
  });
});

describe("useStableSlots", () => {
  it("keeps a wiki's colour when the ranking reshuffles", () => {
    const { result, rerender } = renderHook(({ keys }) => useStableSlots(keys), {
      initialProps: { keys: ["enwiki", "dewiki", "frwiki"] },
    });
    const before = new Map(result.current);
    rerender({ keys: ["frwiki", "enwiki", "dewiki"] });
    expect(result.current.get("frwiki")).toBe(before.get("frwiki"));
    expect(result.current.get("enwiki")).toBe(before.get("enwiki"));
  });

  it("gives a newcomer a free slot, never a colour already on screen", () => {
    const { result, rerender } = renderHook(({ keys }) => useStableSlots(keys), {
      initialProps: { keys: ["a", "b", "c"] },
    });
    rerender({ keys: ["a", "c", "d"] }); // b left, d arrives
    const slots = ["a", "c", "d"].map((k) => result.current.get(k));
    expect(new Set(slots).size).toBe(3);
    expect(result.current.get("d")).toBe(1); // b's freed slot
  });
});

describe("trendDirection", () => {
  it("spots pages that just got busy", () => {
    expect(trendDirection([0, 0, 0, 0, 0, 0, 0, 0, 3, 4])).toBe("rising");
    expect(trendDirection([3, 3, 3, 3, 3, 3, 3, 3, 0, 0])).toBe("falling");
    expect(trendDirection([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe("steady");
  });
});

describe("charts render with data and a table view", () => {
  const snap = makeSnapshot();

  it("heartbeat shows the current rate and a hidden data table", () => {
    const { container } = render(<LiveHeartbeat series={snap.per_second} />);
    const last = snap.per_second[snap.per_second.length - 1];
    expect(screen.getByText(`${last.human + last.bot}/s`)).toBeInTheDocument();
    expect(container.querySelector("table caption")).toHaveTextContent("Edits per second");
    expect(screen.getAllByText("Humans").length).toBeGreaterThan(0);
  });

  it("per-minute chart names wikis in the legend and folds the rest into Other", () => {
    render(<EditsPerMinuteChart data={snap.wiki_minutes} />);
    expect(screen.getAllByText("English").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Other wikis").length).toBeGreaterThan(0);
  });

  it("per-minute tooltip keeps up with new data while the pointer rests on a column", () => {
    const { container, rerender } = render(<EditsPerMinuteChart data={snap.wiki_minutes} />);
    const hitAreas = container.querySelectorAll("g.stack > rect[fill='transparent']");
    fireEvent.pointerEnter(hitAreas[hitAreas.length - 1]);
    expect(container.querySelector(".chart-tooltip-title")).toHaveTextContent("12 edits so far");

    const [a, b, current] = snap.wiki_minutes.points;
    const grown = { ...current, counts: { ...current.counts, enwiki: 10 } };
    rerender(<EditsPerMinuteChart data={{ ...snap.wiki_minutes, points: [a, b, grown] }} />);
    expect(container.querySelector(".chart-tooltip-title")).toHaveTextContent("14 edits so far");
  });

  it("editor mix labels parts that are wide enough with their share", () => {
    render(<EditorMix editors={{ registered: 60, bot: 30, anonymous: 10 }} windowSeconds={300} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.queryByText("10%")).toBeNull(); // too narrow to print; legend + tooltip carry it
    expect(screen.getByRole("img")).toHaveAccessibleName("Registered users 60%, Bots 30%, Logged out 10%");
  });

  it("edit size chart reports the share of removals", () => {
    render(<EditSizeChart bins={snap.size_histogram} windowSeconds={300} />);
    expect(screen.getByText(/12% remove content/)).toBeInTheDocument(); // 7 of 57
  });

  it("busiest wikis filter the dashboard on click, and clicking again clears it", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<BusiestWikis wikis={snap.wikis} selected={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /French/ }));
    expect(onSelect).toHaveBeenLastCalledWith("frwiki");

    rerender(<BusiestWikis wikis={snap.wikis} selected="frwiki" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /French/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /French/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
