import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Sparkle } from "../../components/Sparkle";
import { wikiLabel } from "../../lib/format";
import { TypedText } from "./TypedText";
import { MAX_QUESTION, useAssistant, type ChatMessage } from "./useAssistant";

interface Props {
  /** The dashboard's wiki filter: questions are answered for this wiki. */
  wiki: string | null;
  onUnauthorized?: () => void;
}

/** A short reason why the numbers answered instead of AI. */
export function fallbackReason(note?: string | null) {
  const n = (note ?? "").toLowerCase();
  if (n.includes("hourly limit")) return "AI busy, hourly limit reached";
  if (n.includes("budget")) return "AI daily budget used up";
  if (n.includes("not configured")) return "AI is off";
  return "AI unavailable";
}

function Answer({ message: m, fresh, onTyped }: { message: ChatMessage; fresh: boolean; onTyped: () => void }) {
  if (m.streaming && !m.content) {
    return (
      <li className="assistant-msg assistant-msg-assistant assistant-typing" aria-label="Assistant is typing">
        <span />
        <span />
        <span />
      </li>
    );
  }
  return (
    <li className={`assistant-msg assistant-msg-assistant ${m.error ? "assistant-msg-error" : ""}`}>
      <span className="sr-only">Assistant:</span>
      <TypedText
        text={m.content}
        animate={!m.error && (fresh || !!m.streaming)}
        live={!!m.streaming}
        onDone={m.streaming ? undefined : onTyped}
      />
      {m.stopped && <span className="assistant-note">Stopped</span>}
      {!m.stopped && m.source === "rules" && (
        <span className="assistant-note" title={m.note ?? undefined}>
          From live numbers · {fallbackReason(m.note)}
        </span>
      )}
      {!m.stopped && m.source === "ai" && m.note && <span className="assistant-note">{m.note}</span>}
    </li>
  );
}

/** Floating "Ask AI" button and chat panel. Answers come from the live dashboard data. */
export function AssistantChat({ wiki, onUnauthorized }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { messages, busy, send, stop, clear, suggestions, aiEnabled } = useAssistant(wiki, onUnauthorized);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  // Answers that have finished typing: reopening the panel shows them at once.
  const typed = useRef(new Set<number>());

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Follow the answer as it is typed, unless the user has scrolled up to read.
  const stick = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const follow = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    follow();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messages, open]);
  const onScroll = () => {
    const el = list.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Grow the input with its text, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  const close = () => {
    setOpen(false);
    fab.current?.focus();
  };

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    stick.current = true;
    void send(text);
    setDraft("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };

  // Announced once complete (the typing itself would be read character by character).
  const last = messages[messages.length - 1];
  const lastAnswer = last?.role === "assistant" && !last.streaming ? last.content : "";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  };

  return (
    <>
      <button
        ref={fab}
        type="button"
        className={`assistant-fab ${open ? "assistant-fab-open" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={open ? "assistant-panel" : undefined}
        aria-label={open ? "Close AI assistant" : "Ask the AI assistant"}
      >
        {open ? <span aria-hidden="true">✕</span> : <Sparkle className="assistant-fab-icon" />}
        {!open && <span className="assistant-fab-label">Ask AI</span>}
      </button>

      {open && (
        <section
          id="assistant-panel"
          className="assistant"
          role="dialog"
          aria-label="AI assistant"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <header className="assistant-head">
            <span className="assistant-avatar" aria-hidden="true">
              <Sparkle />
            </span>
            <div className="assistant-title">
              <h2>WikiPulse Assistant</h2>
              <p className="muted small">
                Answers from live data · {wiki ? wikiLabel(wiki) : "all wikis"}
                {aiEnabled === false && " · AI off"}
              </p>
            </div>
            {messages.length > 0 && (
              <button type="button" className="btn-ghost assistant-clear" onClick={clear}>
                Clear
              </button>
            )}
            <button type="button" className="icon-btn assistant-close" onClick={close} aria-label="Close">
              ✕
            </button>
          </header>

          <div className="assistant-body" ref={list} onScroll={onScroll}>
            {messages.length === 0 ? (
              <div className="assistant-empty">
                <p className="assistant-hello">Hi! Ask me about what's happening on Wikipedia right now.</p>
                <p className="muted small">I answer from the dashboard's live numbers. Try one of these:</p>
                <div className="assistant-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="assistant-chip" onClick={() => submit(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="assistant-messages">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <li key={m.id} className="assistant-msg assistant-msg-user">
                      <span className="sr-only">You:</span>
                      <p dir="auto">{m.content}</p>
                    </li>
                  ) : (
                    <Answer
                      key={m.id}
                      message={m}
                      fresh={!typed.current.has(m.id)}
                      onTyped={() => typed.current.add(m.id)}
                    />
                  ),
                )}
              </ol>
            )}
          </div>

          <p className="sr-only" aria-live="polite">
            {lastAnswer ? `Assistant said: ${lastAnswer}` : ""}
          </p>

          <form className="assistant-input" onSubmit={onSubmit}>
            <label htmlFor="assistant-question" className="sr-only">
              Ask a question
            </label>
            <textarea
              id="assistant-question"
              ref={input}
              rows={1}
              value={draft}
              maxLength={MAX_QUESTION}
              placeholder="Ask about trends, vandalism, wikis…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {busy ? (
              <button
                type="button"
                className="assistant-send assistant-stop"
                onClick={stop}
                aria-label="Stop answering"
              >
                <span aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className="assistant-send" disabled={!draft.trim()} aria-label="Send">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12l16-8-6 16-2.5-6.5z" />
                </svg>
              </button>
            )}
          </form>
          {draft.length > MAX_QUESTION - 100 && (
            <p className="assistant-count muted small">
              {draft.length}/{MAX_QUESTION}
            </p>
          )}
        </section>
      )}
    </>
  );
}
