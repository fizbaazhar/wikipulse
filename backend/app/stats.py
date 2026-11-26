"""Rolling statistics over the edit stream.

Design decision: windows are based on **arrival time** (when the back end
received the event), not the event's own ``timestamp``. "Trending right now"
means what is happening now; Wikimedia's stream lag is a few seconds, and this
makes out-of-order or badly-timestamped events harmless. The clock is injected
so the logic is fully deterministic in tests.

All structures are bounded: the window deque only holds the last
``window_seconds`` of events and the per-minute history only
``history_minutes`` buckets. Chart series (per second, per page trend, size
histogram, editor mix) are computed from the window on demand.
"""
from __future__ import annotations

import heapq
import time
from collections import Counter, OrderedDict, deque
from typing import Any, Callable, Deque, Dict, Iterable, List, NamedTuple, Optional, Tuple

from .parser import Edit

PageKey = Tuple[str, str]  # (wiki, title)

HEARTBEAT_SECONDS = 120  # per-second chart: last two minutes
TREND_BUCKETS = 10  # sparkline points per top page, spread across the window
STACK_WIKIS = 5  # per-minute chart: top wikis shown, the rest folded into "other"

# Edit size histogram: (label, low inclusive, high exclusive), bytes.
SIZE_BINS: List[Tuple[str, float, float]] = [
    ("−10K+", float("-inf"), -10_000),
    ("−1K", -10_000, -1_000),
    ("−100", -1_000, -100),
    ("−10", -100, -10),
    ("−1", -10, 0),
    ("0", 0, 1),
    ("+1", 1, 10),
    ("+10", 10, 100),
    ("+100", 100, 1_000),
    ("+1K", 1_000, 10_000),
    ("+10K+", 10_000, float("inf")),
]


class _Entry(NamedTuple):
    at: float
    wiki: str
    title: str
    bot: bool
    anonymous: bool
    delta: Optional[int]


class RollingStats:
    def __init__(
        self,
        window_seconds: int = 300,
        history_minutes: int = 30,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.window_seconds = window_seconds
        self.history_minutes = history_minutes
        self._clock = clock

        self._events: Deque[_Entry] = deque()
        self._pages: Counter = Counter()  # PageKey -> count in window
        self._urls: Dict[PageKey, str] = {}
        self._wikis: Counter = Counter()  # wiki -> count in window
        self._bots = 0
        self._minutes: "OrderedDict[int, Counter]" = OrderedDict()  # minute start -> wiki counts

    # ------------------------------------------------------------------ #
    def add(self, edit: Edit, now: Optional[float] = None) -> None:
        now = self._clock() if now is None else now
        key = (edit.wiki, edit.title)

        self._events.append(_Entry(now, edit.wiki, edit.title, edit.bot, edit.anonymous, edit.delta))
        self._pages[key] += 1
        self._urls[key] = edit.url
        self._wikis[edit.wiki] += 1
        self._bots += int(edit.bot)

        minute = int(now // 60) * 60
        bucket = self._minutes.get(minute)
        if bucket is None:
            bucket = self._minutes[minute] = Counter()
        bucket[edit.wiki] += 1

        self._evict(now)

    def _evict(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._events and self._events[0].at <= cutoff:
            old = self._events.popleft()
            key = (old.wiki, old.title)
            self._pages[key] -= 1
            if self._pages[key] <= 0:
                del self._pages[key]
                self._urls.pop(key, None)
            self._wikis[old.wiki] -= 1
            if self._wikis[old.wiki] <= 0:
                del self._wikis[old.wiki]
            self._bots -= int(old.bot)

        oldest_minute = (int(now // 60) - self.history_minutes + 1) * 60
        while self._minutes and next(iter(self._minutes)) < oldest_minute:
            self._minutes.popitem(last=False)

    def _window(self, wiki: Optional[str]) -> Iterable[_Entry]:
        return self._events if wiki is None else (e for e in self._events if e.wiki == wiki)

    # ------------------------------------------------------------------ #
    def snapshot(self, wiki: Optional[str] = None, top_n: int = 10) -> Dict[str, Any]:
        """Current stats, optionally restricted to a single wiki."""
        now = self._clock()
        self._evict(now)

        # Edits in the last 60 s (rolling).
        minute_ago = now - 60
        last_minute = 0
        for entry in reversed(self._events):
            if entry.at <= minute_ago:
                break
            if wiki is None or entry.wiki == wiki:
                last_minute += 1

        if wiki is None:
            in_window, bots = len(self._events), self._bots
            pages = self._pages.items()
        else:
            in_window = self._wikis.get(wiki, 0)
            bots = sum(1 for e in self._events if e.wiki == wiki and e.bot)
            pages = ((k, c) for k, c in self._pages.items() if k[0] == wiki)

        # Highest count first; ties broken alphabetically so output is stable.
        top = heapq.nsmallest(top_n, pages, key=lambda kv: (-kv[1], kv[0][0], kv[0][1]))
        trends = self._page_trends({k for k, _ in top}, now)

        return {
            "generated_at": now,
            "wiki": wiki,
            "window_seconds": self.window_seconds,
            "edits_last_minute": last_minute,
            "edits_in_window": in_window,
            "bot_share": round(bots / in_window, 3) if in_window else 0.0,
            "edits_per_minute": self._minute_series(wiki, now),
            "wiki_minutes": self._wiki_minute_series(wiki, now),
            "per_second": self._per_second(wiki, now),
            "editors": self._editor_mix(wiki),
            "size_histogram": self._size_histogram(wiki),
            "top_pages": [
                {"wiki": k[0], "title": k[1], "count": c, "url": self._urls.get(k, ""), "trend": trends.get(k, [])}
                for k, c in top
            ],
            "wikis": [{"wiki": w, "count": c} for w, c in self._wikis.most_common()],
        }

    # ------------------------------------------------------------------ #
    def _minute_starts(self, now: float) -> List[int]:
        current = int(now // 60) * 60
        return [current - i * 60 for i in range(self.history_minutes - 1, -1, -1)]

    def _minute_series(self, wiki: Optional[str], now: float) -> List[Dict[str, int]]:
        series = []
        for minute in self._minute_starts(now):
            bucket = self._minutes.get(minute)
            if bucket is None:
                count = 0
            elif wiki is None:
                count = sum(bucket.values())
            else:
                count = bucket.get(wiki, 0)
            series.append({"minute": minute, "count": count})
        return series

    def _wiki_minute_series(self, wiki: Optional[str], now: float) -> Dict[str, Any]:
        """Per-minute counts split by the busiest wikis, the rest folded into "other"."""
        if wiki is not None:
            keys = [wiki]
        else:
            totals: Counter = Counter()
            for bucket in self._minutes.values():
                totals.update(bucket)
            keys = [w for w, _ in totals.most_common(STACK_WIKIS)]
        points = []
        for minute in self._minute_starts(now):
            bucket = self._minutes.get(minute) or Counter()
            counts = {k: bucket.get(k, 0) for k in keys}
            if wiki is None:
                counts["other"] = sum(bucket.values()) - sum(counts.values())
            points.append({"minute": minute, "counts": counts})
        return {"keys": keys + ([] if wiki else ["other"]), "points": points}

    def _per_second(self, wiki: Optional[str], now: float) -> List[Dict[str, int]]:
        """Humans vs bots per completed second, last HEARTBEAT_SECONDS seconds."""
        end = int(now)  # the current second is still filling, so it is left out
        start = end - HEARTBEAT_SECONDS
        humans = [0] * HEARTBEAT_SECONDS
        bots = [0] * HEARTBEAT_SECONDS
        for entry in reversed(self._events):
            second = int(entry.at)
            if second < start:
                break
            if second >= end or (wiki is not None and entry.wiki != wiki):
                continue
            if entry.bot:
                bots[second - start] += 1
            else:
                humans[second - start] += 1
        return [{"t": start + i, "human": humans[i], "bot": bots[i]} for i in range(HEARTBEAT_SECONDS)]

    def _page_trends(self, keys: set, now: float) -> Dict[PageKey, List[int]]:
        """Edits per slice of the window for each top page (sparkline data)."""
        if not keys:
            return {}
        width = self.window_seconds / TREND_BUCKETS
        start = now - self.window_seconds
        trends = {k: [0] * TREND_BUCKETS for k in keys}
        for entry in self._events:
            row = trends.get((entry.wiki, entry.title))
            if row is not None:
                row[min(TREND_BUCKETS - 1, max(0, int((entry.at - start) / width)))] += 1
        return trends

    def _editor_mix(self, wiki: Optional[str]) -> Dict[str, int]:
        mix = {"registered": 0, "bot": 0, "anonymous": 0}
        for entry in self._window(wiki):
            mix["bot" if entry.bot else "anonymous" if entry.anonymous else "registered"] += 1
        return mix

    def _size_histogram(self, wiki: Optional[str]) -> List[Dict[str, Any]]:
        counts = [0] * len(SIZE_BINS)
        for entry in self._window(wiki):
            if entry.delta is None:
                continue
            for i, (_, low, high) in enumerate(SIZE_BINS):
                if low <= entry.delta < high:
                    counts[i] += 1
                    break
        return [
            {"label": label, "sign": -1 if high <= 0 else (0 if low == 0 and high == 1 else 1), "count": counts[i]}
            for i, (label, low, high) in enumerate(SIZE_BINS)
        ]
