import { useCallback, useEffect, useRef, useState } from "react";
import { useLatest } from "../../hooks/useLatest";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** For answers: "ai", or "rules" when AI was unavailable and the numbers answered. */
  source?: "ai" | "rules";
  note?: string | null;
  /** The request failed; the text is an error to show, not a real answer. */
  error?: boolean;
  /** Still arriving from the server. */
  streaming?: boolean;
  /** The user pressed Stop. */
  stopped?: boolean;
}

export const MAX_QUESTION = 500;
/** How much of the conversation goes back to the server as context. */
const HISTORY = 12;

const DEFAULT_SUGGESTIONS = [
  "What is trending right now?",
  "Which edits look like vandalism, and why?",
  "Which wikis are busiest?",
  "How much of the editing is by bots?",
];

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; source: "ai" | "rules"; note: string | null };

/** Reads newline-delimited JSON events from a streaming response. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as StreamEvent;
      }
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer) as StreamEvent;
  } finally {
    reader.releaseLock();
  }
}

/** Conversation with the dashboard's AI assistant. Kept in memory only. */
export function useAssistant(wiki: string | null, onUnauthorized?: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const unauthorized = useLatest(onUnauthorized);
  const messagesRef = useLatest(messages);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    let alive = true;
    fetch("/api/assistant", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { ai_enabled: boolean; suggestions: string[] } | null) => {
        if (!info || !alive) return;
        setAiEnabled(info.ai_enabled);
        if (info.suggestions?.length) setSuggestions(info.suggestions);
      })
      .catch(() => {});
    return () => {
      alive = false;
      controller.current?.abort(); // closing the dashboard stops a running answer
    };
  }, []);

  const update = (id: number, change: (m: ChatMessage) => ChatMessage) =>
    setMessages((all) => all.map((m) => (m.id === id ? change(m) : m)));

  const send = useCallback(
    async (text: string) => {
      const question = text.trim().slice(0, MAX_QUESTION);
      if (!question || controller.current) return;
      // Failed or stopped exchanges are not sent back as context.
      const history = messagesRef.current
        .filter((m) => !m.error && !m.stopped && m.content)
        .slice(-HISTORY)
        .map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
      const answerId = nextId.current + 1;
      nextId.current += 2;
      setMessages((m) => [
        ...m,
        { id: answerId - 1, role: "user", content: question },
        { id: answerId, role: "assistant", content: "", streaming: true },
      ]);
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);

      try {
        const response = await fetch("/api/assistant/chat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...history, { role: "user", content: question }], wiki }),
          signal: abort.signal,
        });
        if (response.status === 401) {
          setMessages((all) => all.filter((m) => m.id !== answerId));
          unauthorized.current?.();
          return;
        }
        if (!response.ok || !response.body) throw new Error(String(response.status));
        for await (const event of readEvents(response.body)) {
          if (event.type === "delta") update(answerId, (m) => ({ ...m, content: m.content + event.text }));
          else update(answerId, (m) => ({ ...m, source: event.source, note: event.note }));
        }
        update(answerId, (m) => ({ ...m, streaming: false }));
      } catch {
        if (abort.signal.aborted) {
          update(answerId, (m) => ({ ...m, streaming: false, stopped: true }));
        } else {
          update(answerId, (m) =>
            m.content
              ? { ...m, streaming: false, note: "The connection dropped before the answer finished." }
              : {
                  ...m,
                  streaming: false,
                  error: true,
                  content: "Sorry, I couldn't reach the server. Please try again.",
                },
          );
        }
      } finally {
        controller.current = null;
        setBusy(false);
      }
    },
    [wiki],
  );

  /** Stop the answer that is being written. */
  const stop = useCallback(() => controller.current?.abort(), []);

  const clear = useCallback(() => {
    controller.current?.abort();
    setMessages([]);
  }, []);

  return { messages, busy, send, stop, clear, suggestions, aiEnabled };
}
