import type { Edit, Flag, Snapshot } from "../types";

export function makeEdit(overrides: Partial<Edit> = {}): Edit {
  return {
    id: "e1",
    wiki: "enwiki",
    title: "Mars",
    url: "https://en.wikipedia.org/wiki/Mars",
    user: "Alice",
    bot: false,
    type: "edit",
    namespace: 0,
    comment: "Fixed a typo",
    timestamp: 1_800_000_000,
    minor: false,
    length_old: 1000,
    length_new: 1100,
    delta: 100,
    diff_url: "https://en.wikipedia.org/w/index.php?diff=2&oldid=1",
    flag: null,
    ...overrides,
  };
}

export function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    status: "flagged",
    score: 0.6,
    reason: "page cut from 8000 to 10 bytes",
    signals: ["blanking"],
    source: "rules",
    ai_confidence: null,
    note: null,
    ...overrides,
  };
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    generated_at: 1_800_000_000,
    wiki: null,
    window_seconds: 300,
    edits_last_minute: 42,
    edits_in_window: 180,
    bot_share: 0.25,
    edits_per_minute: [
      { minute: 1_799_999_880, count: 30 },
      { minute: 1_799_999_940, count: 40 },
      { minute: 1_800_000_000, count: 12 },
    ],
    wiki_minutes: {
      keys: ["enwiki", "frwiki", "other"],
      points: [
        { minute: 1_799_999_880, counts: { enwiki: 20, frwiki: 6, other: 4 } },
        { minute: 1_799_999_940, counts: { enwiki: 28, frwiki: 8, other: 4 } },
        { minute: 1_800_000_000, counts: { enwiki: 8, frwiki: 3, other: 1 } },
      ],
    },
    per_second: Array.from({ length: 120 }, (_, i) => ({ t: 1_799_999_880 + i, human: i % 5, bot: i % 3 })),
    editors: { registered: 120, bot: 45, anonymous: 15 },
    size_histogram: [
      { label: "−10K+", sign: -1, count: 2 },
      { label: "−1K", sign: -1, count: 5 },
      { label: "0", sign: 0, count: 10 },
      { label: "+100", sign: 1, count: 40 },
    ],
    top_pages: [
      { wiki: "enwiki", title: "Mars", count: 9, url: "https://en.wikipedia.org/wiki/Mars", trend: [0, 1, 0, 2, 1, 0, 1, 2, 1, 1] },
    ],
    wikis: [{ wiki: "enwiki", count: 150 }, { wiki: "frwiki", count: 30 }],
    ...overrides,
  };
}
