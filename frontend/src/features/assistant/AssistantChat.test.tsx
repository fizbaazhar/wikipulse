import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantChat, fallbackReason } from "./AssistantChat";

type Handler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A streamed answer: NDJSON events, split at awkward places like a real network. */
function stream(text: string[], done: object = { source: "ai", note: null }) {
  const raw = [
    ...text.map((t) => ({ type: "delta", text: t })),
    { type: "done", ...done },
  ]
    .map((e) => JSON.stringify(e) + "\n")
    .join("");
  const bytes = new TextEncoder().encode(raw);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7)
        c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

let handler: Handler;
const fetchMock = vi.fn((url: string, init?: RequestInit) =>
  Promise.resolve(handler(url, init)),
);

beforeEach(() => {
  fetchMock.mockClear();
  // Show streamed text at once in tests (the typing animation is visual only).
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce"),
    media: query,
  }));
  vi.stubGlobal("fetch", fetchMock);
  handler = (url) =>
    url === "/api/assistant"
      ? json({ ai_enabled: true, suggestions: ["What is trending right now?"] })
      : stream(["Mars leads ", "with 12 edits."]);
});
afterEach(() => vi.unstubAllGlobals());

function chatBodies() {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/assistant/chat")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe("AssistantChat", () => {
  it("opens, sends a question with the wiki filter and shows the answer", async () => {
    render(<AssistantChat wiki="enwiki" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    );
    expect(
      screen.getByRole("dialog", { name: "AI assistant" }),
    ).toHaveTextContent("English");

    await userEvent.type(
      screen.getByLabelText("Ask a question"),
      "What is trending?{Enter}",
    );
    expect(
      await screen.findByText("Mars leads with 12 edits."),
    ).toBeInTheDocument();
    expect(screen.getByText("What is trending?")).toBeInTheDocument();
    expect(chatBodies()[0]).toEqual({
      messages: [{ role: "user", content: "What is trending?" }],
      wiki: "enwiki",
    });
    expect(screen.getByLabelText("Ask a question")).toHaveValue("");
  });

  it("sends earlier turns as context, and a suggestion sends straight away", async () => {
    render(<AssistantChat wiki={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "What is trending right now?",
      }),
    );
    await screen.findByText("Mars leads with 12 edits.");

    await userEvent.type(
      screen.getByLabelText("Ask a question"),
      "And bots?{Enter}",
    );
    await waitFor(() => expect(chatBodies()).toHaveLength(2));
    expect(chatBodies()[1].messages).toEqual([
      { role: "user", content: "What is trending right now?" },
      { role: "assistant", content: "Mars leads with 12 edits." },
      { role: "user", content: "And bots?" },
    ]);
  });

  it("says when the answer came from the numbers, not AI", async () => {
    handler = (url) =>
      url === "/api/assistant"
        ? json({ ai_enabled: true, suggestions: [] })
        : stream(["52% bots."], {
            source: "rules",
            note: "AI unavailable (budget reached)",
          });
    render(<AssistantChat wiki={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    );
    await userEvent.type(
      screen.getByLabelText("Ask a question"),
      "bots?{Enter}",
    );
    expect(
      await screen.findByText("From live numbers · AI daily budget used up"),
    ).toHaveAttribute("title", "AI unavailable (budget reached)");
  });

  it("shows a friendly error and reports an expired session", async () => {
    const onUnauthorized = vi.fn();
    handler = (url) =>
      url === "/api/assistant"
        ? json({}, 500)
        : json({ detail: "login required" }, 401);
    render(<AssistantChat wiki={null} onUnauthorized={onUnauthorized} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    );
    await userEvent.type(screen.getByLabelText("Ask a question"), "hi{Enter}");
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());

    handler = () => Promise.reject(new TypeError("offline"));
    await userEvent.type(
      screen.getByLabelText("Ask a question"),
      "again{Enter}",
    );
    expect(
      await screen.findByText(
        "Sorry, I couldn't reach the server. Please try again.",
      ),
    ).toBeInTheDocument();
  });

  it("can stop an answer while it is being written", async () => {
    let push: (text: string) => void = () => {};
    handler = (url, init) => {
      if (url === "/api/assistant")
        return json({ ai_enabled: true, suggestions: [] });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (t) =>
            c.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ type: "delta", text: t }) + "\n",
              ),
            );
          init?.signal?.addEventListener("abort", () =>
            c.error(new DOMException("Aborted", "AbortError")),
          );
        },
      });
      return new Response(body);
    };
    render(<AssistantChat wiki={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    );
    await userEvent.type(screen.getByLabelText("Ask a question"), "hi{Enter}");
    expect(screen.getByLabelText("Assistant is typing")).toBeInTheDocument();
    await waitFor(() => expect(chatBodies()).toHaveLength(1));
    push("Half an ans");
    expect(await screen.findByText("Half an ans")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Stop answering" }),
    );
    expect(await screen.findByText("Stopped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("types out an answer that arrives all at once, instead of showing it in one go", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
    }));
    const answer =
      "The busiest wikis right now are Wikidata, English and German Wikipedia.";
    handler = (url) =>
      url === "/api/assistant"
        ? json({ ai_enabled: true, suggestions: [] })
        : stream([answer], { source: "rules", note: null });
    render(<AssistantChat wiki={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    );
    await userEvent.type(
      screen.getByLabelText("Ask a question"),
      "busiest?{Enter}",
    );

    const typedSoFar = () =>
      document.querySelector(".assistant-msg-assistant p")?.textContent ?? "";
    await waitFor(() => expect(typedSoFar().length).toBeGreaterThan(0));
    expect(typedSoFar().length).toBeLessThan(answer.length); // still typing
    await waitFor(() => expect(typedSoFar()).toBe(answer), { timeout: 4000 });
  });

  it("Shift+Enter makes a new line, Escape closes", async () => {
    render(<AssistantChat wiki={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    );
    const box = screen.getByLabelText("Ask a question");
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("line one\nline two");
    expect(chatBodies()).toHaveLength(0);

    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ask the AI assistant" }),
    ).toHaveFocus();
  });

  it("names the reason the numbers answered", () => {
    expect(fallbackReason("AI is paused (hourly limit reached), so ...")).toBe(
      "AI busy, hourly limit reached",
    );
    expect(fallbackReason("AI is not configured, so ...")).toBe("AI is off");
    expect(fallbackReason("AI unavailable (network error)")).toBe(
      "AI unavailable",
    );
  });
});
