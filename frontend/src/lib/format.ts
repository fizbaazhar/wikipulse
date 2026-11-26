const WIKI_NAMES: Record<string, string> = {
  enwiki: "English",
  dewiki: "German",
  frwiki: "French",
  eswiki: "Spanish",
  itwiki: "Italian",
  jawiki: "Japanese",
  ruwiki: "Russian",
  ptwiki: "Portuguese",
  zhwiki: "Chinese",
  arwiki: "Arabic",
  urwiki: "Urdu",
  hiwiki: "Hindi",
  plwiki: "Polish",
  nlwiki: "Dutch",
  svwiki: "Swedish",
  ukwiki: "Ukrainian",
  fawiki: "Persian",
  commonswiki: "Commons",
  wikidatawiki: "Wikidata",
};

/** "enwiki" -> "English", unknown ids are returned unchanged. */
export function wikiLabel(wiki: string): string {
  return WIKI_NAMES[wiki] ?? wiki;
}

/** Readable name plus the raw id when they differ: ["French", "frwiki"], or ["xxwiki", null]. */
export function wikiNameAndId(wiki: string): [name: string, id: string | null] {
  const name = wikiLabel(wiki);
  return [name, name === wiki ? null : wiki];
}

/** The server's rolling window, in whole minutes (it sends seconds). */
export function windowMinutes(windowSeconds: number): number {
  return Math.round(windowSeconds / 60);
}

/** Only http(s) links ever reach an href, whatever the data says. */
export function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return `${sign}${Math.abs(delta).toLocaleString("en-US")}`;
}

export function formatClock(epochSeconds: number | null): string {
  if (epochSeconds === null) return "";
  return new Date(epochSeconds * 1000).toLocaleTimeString("en-GB", { hour12: false });
}

export function formatMinute(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(epochSeconds: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.round(nowMs / 1000 - epochSeconds));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
