"""Source -> parse -> de-duplicate -> stats. Counts every outcome."""
from __future__ import annotations

import logging
from collections import Counter, deque
from typing import Any, Deque, Dict, List, Optional, Tuple

from .parser import Deduper, Edit, InvalidEvent, parse_line
from .stats import RollingStats

log = logging.getLogger(__name__)


class Pipeline:
    def __init__(
        self,
        source: Any,
        stats: RollingStats,
        deduper: Optional[Deduper] = None,
        recent_size: int = 200,
        pending_size: int = 5_000,
        moderator: Any = None,
    ) -> None:
        self.source = source
        self.stats = stats
        self.moderator = moderator  # optional: scores every accepted edit for vandalism
        self.deduper = deduper or Deduper()
        self.counters: Counter = Counter()
        self.recent: Deque[Edit] = deque(maxlen=recent_size)
        # Edits waiting to be broadcast on the next tick. Bounded so a stalled
        # broadcaster can never grow memory without limit.
        self._pending: Deque[Tuple[int, Edit]] = deque(maxlen=pending_size)
        # Monotonic sequence number of the last accepted edit. Lets a client
        # that just received ``recent`` skip pending edits it already has.
        self.seq = 0

    async def run(self) -> None:
        async for line in self.source.lines():
            self.process_line(line)
        log.info("source %s finished", getattr(self.source, "name", "?"))

    def process_line(self, line: str) -> Optional[Edit]:
        self.counters["received"] += 1
        try:
            edit = parse_line(line)
        except InvalidEvent as exc:
            self.counters[f"skipped_{exc.reason}"] += 1
            return None
        except Exception:  # never let one bad event kill the stream
            log.exception("unexpected error while parsing an event")
            self.counters["errors"] += 1
            return None

        if self.deduper.seen(edit.id):
            self.counters["duplicates"] += 1
            return None

        self.counters["accepted"] += 1
        self.stats.add(edit)
        if self.moderator is not None:
            self.moderator.observe(edit)
        self.seq += 1
        self.recent.append(edit)
        self._pending.append((self.seq, edit))
        return edit

    def drain(self) -> List[Tuple[int, Edit]]:
        """Return and clear ``(seq, edit)`` pairs received since the last call."""
        items = list(self._pending)
        self._pending.clear()
        return items

    def status(self) -> Dict[str, Any]:
        return {"counters": dict(self.counters), **self.source.status()}
