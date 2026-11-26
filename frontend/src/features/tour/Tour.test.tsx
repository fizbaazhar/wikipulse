import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tour, type TourStep } from "./Tour";
import { useTour } from "./useTour";

const STEPS: TourStep[] = [
  { title: "Welcome", body: "Intro" },
  { target: "#one", title: "First section", body: "About one" },
  { target: "#missing", title: "Not on screen", body: "Skipped" },
  { target: "#two", title: "Second section", body: "About two" },
];

function page() {
  document.body.innerHTML = '<div id="one"></div><div id="two"></div>';
}

describe("Tour", () => {
  beforeEach(page);

  it("walks the steps, skipping targets that aren't on the page", () => {
    const onClose = vi.fn();
    render(<Tour steps={STEPS} onClose={onClose} />);
    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
    expect(screen.getByRole("heading", { name: "First section" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Second section" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "First section" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and on Skip", () => {
    const onClose = vi.fn();
    render(<Tour steps={STEPS} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps focus inside the dialog and gives it back on close", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Tour steps={STEPS} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));

    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" }); // last control: wraps to the first
    expect(screen.getByRole("button", { name: "Skip tour" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true }); // and back again
    expect(next).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
  });
});

describe("useTour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("opens once on the first visit and remembers it was seen", () => {
    const first = renderHook(() => useTour());
    act(() => vi.advanceTimersByTime(1000));
    expect(first.result.current.open).toBe(true);
    act(() => first.result.current.close());
    expect(first.result.current.open).toBe(false);

    const again = renderHook(() => useTour());
    act(() => vi.advanceTimersByTime(1000));
    expect(again.result.current.open).toBe(false);
    act(() => again.result.current.start());
    expect(again.result.current.open).toBe(true);
  });
});
