import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "../../lib/motion";

export interface TourStep {
  /** CSS selector of the element to highlight; omit for a centred intro/outro card. */
  target?: string;
  title: string;
  body: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // space between the highlight and the element
const GAP = 14; // space between the highlight and the popover
const MARGIN = 16; // keep the popover this far from the screen edges

function sameRect(a: Rect | null, b: Rect | null) {
  return (
    a === b ||
    (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)
  );
}

/** Keep Tab and Shift+Tab cycling through the popover's controls (it is a modal dialog). */
function trapTab(event: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!container.contains(active) || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

interface Props {
  steps: TourStep[];
  onClose: () => void;
}

/** Guided tour: dims the page, spotlights one section at a time and explains it. */
export function Tour({ steps, onClose }: Props) {
  // Skip steps whose element isn't on screen (e.g. a control hidden on mobile).
  const [visible] = useState(() => steps.filter((s) => !s.target || document.querySelector(s.target)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popSize, setPopSize] = useState({ width: 0, height: 0 });
  const popover = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);

  const step = visible[index];
  const last = index === visible.length - 1;

  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Give focus back to whatever had it (usually the "?" button) when the tour closes.
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  // Bring the section into view and focus the main button when the step changes.
  useEffect(() => {
    const el = step?.target ? document.querySelector(step.target) : null;
    el?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    nextBtn.current?.focus();
  }, [step]);

  // Follow the element while it scrolls, resizes or the page reflows.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const el = step?.target ? document.querySelector(step.target) : null;
      const r = el?.getBoundingClientRect();
      const nextRect = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setRect((prev) => (sameRect(prev, nextRect) ? prev : nextRect));
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useLayoutEffect(() => {
    const el = popover.current;
    if (el) setPopSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [index, rect?.width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "Tab") trapTab(e, popover.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  if (!step) return null;

  // Place the popover below the section, else above, else over its bottom edge.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let style: CSSProperties;
  if (!rect) {
    style = { top: Math.max(MARGIN, (vh - popSize.height) / 2), left: Math.max(MARGIN, (vw - popSize.width) / 2) };
  } else {
    const { width: pw, height: ph } = popSize;
    const below = rect.top + rect.height + PAD + GAP;
    const above = rect.top - PAD - GAP - ph;
    const right = rect.left + rect.width + PAD + GAP;
    const leftSide = rect.left - PAD - GAP - pw;
    const clampLeft = (x: number) => Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - pw - MARGIN));
    const clampTop = (y: number) => Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - ph - MARGIN));
    // Beside a tall section, line up with its visible top.
    const sideTop = clampTop(Math.max(rect.top, MARGIN + 64));
    if (below + ph <= vh - MARGIN) style = { top: below, left: clampLeft(rect.left) };
    else if (above >= MARGIN) style = { top: above, left: clampLeft(rect.left) };
    else if (right + pw <= vw - MARGIN) style = { top: sideTop, left: right };
    else if (leftSide >= MARGIN) style = { top: sideTop, left: leftSide };
    else style = { top: clampTop(vh - ph - MARGIN), left: clampLeft(rect.left) };
  }

  return (
    <div className="tour">
      {/* Catch clicks so the page underneath can't be used mid-tour. */}
      <div className={`tour-backdrop ${rect ? "" : "tour-backdrop-dim"}`} onClick={onClose} aria-hidden="true" />
      {rect && (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      )}
      <div
        ref={popover}
        className="tour-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={style}
        key={index}
      >
        <p className="tour-step muted small">
          Step {index + 1} of {visible.length}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {visible.map((s, i) => (
            <span key={s.title} className={i === index ? "active" : i < index ? "done" : ""} />
          ))}
        </div>
        <div className="tour-actions">
          {!last && (
            <button type="button" className="btn-ghost tour-skip" onClick={onClose}>
              Skip tour
            </button>
          )}
          <span className="tour-spacer" />
          {index > 0 && (
            <button type="button" className="btn-ghost" onClick={back}>
              Back
            </button>
          )}
          <button ref={nextBtn} type="button" className="btn-primary tour-next" onClick={next}>
            {last ? "Finish" : index === 0 ? "Start tour" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
