"""Fan-out of live updates to WebSocket clients.

Instead of pushing every edit individually (the live stream peaks at dozens of
edits per second), the hub ticks once per ``interval`` and sends each client:

* ``{"type": "edits", "items": [...]}``: new edits since the last tick,
  filtered by the client's wiki and capped at ``max_edits_per_tick``
* ``{"type": "flags", "items": [...]}``: edits whose vandalism flag changed
  (e.g. the AI verdict arrived)
* ``{"type": "pulse", "data": {...}}``: when the Pulse summary changed
* ``{"type": "snapshot", "data": {...}}``: current rolling stats

Each client has a small bounded outbox. A slow client never slows the others
down or grows memory, and what it loses is chosen carefully (see ``Client``).
"""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Set

from .parser import Edit
from .pipeline import Pipeline
from .stats import RollingStats

log = logging.getLogger(__name__)


# Only the newest of these matters, so a waiting one is replaced, not queued.
LATEST_ONLY = frozenset({"snapshot", "pulse"})
# These replace the client's whole view, so anything still waiting is stale.
FULL_STATE = frozenset({"hello", "reset"})


class Client:
    """Outbox for one WebSocket client.

    A slow client must not lose messages it cannot recover from:

    * ``snapshot``/``pulse``: only the latest one is kept.
    * ``hello``/``reset``: never dropped; they also discard anything older,
      which belonged to the previous view.
    * ``edits``: the feed is best effort, so when the outbox is full the
      oldest ``edits`` batch is dropped first.
    * ``flags``/``error``: kept; they are small and rare. Only past a hard cap
      (4x the size) is anything other than full state dropped.
    """

    def __init__(self, seen_seq: int = 0, queue_size: int = 32) -> None:
        self.wiki: Optional[str] = None
        # Edits up to this sequence number were already sent in hello/reset.
        self.seen_seq = seen_seq
        self.queue_size = queue_size
        self.dropped = 0
        self._pending: Deque[Dict[str, Any]] = deque()
        self._ready = asyncio.Event()

    def offer(self, message: Dict[str, Any]) -> None:
        kind = message.get("type")
        if kind in FULL_STATE:
            self._pending.clear()
        elif kind in LATEST_ONLY:
            self._pending = deque(m for m in self._pending if m.get("type") != kind)
        self._pending.append(message)
        self._trim()
        self._ready.set()

    def _trim(self) -> None:
        while len(self._pending) > self.queue_size and self._drop_first({"edits"}):
            pass
        while len(self._pending) > self.queue_size * 4 and self._drop_first(None):
            pass

    def _drop_first(self, kinds: Optional[Set[str]]) -> bool:
        for i, m in enumerate(self._pending):
            kind = m.get("type")
            if kind not in FULL_STATE and (kinds is None or kind in kinds):
                del self._pending[i]
                self.dropped += 1
                return True
        return False

    async def next_message(self) -> Dict[str, Any]:
        while not self._pending:
            self._ready.clear()
            await self._ready.wait()
        return self._pending.popleft()

    def drain(self) -> List[Dict[str, Any]]:
        """Take every waiting message (used by tests)."""
        items = list(self._pending)
        self._pending.clear()
        return items


class Hub:
    def __init__(
        self,
        pipeline: Pipeline,
        stats: RollingStats,
        interval: float = 1.0,
        max_edits_per_tick: int = 100,
        moderator: Any = None,
        pulse: Any = None,
    ) -> None:
        self.pipeline = pipeline
        self.stats = stats
        self.interval = interval
        self.max_edits_per_tick = max_edits_per_tick
        self.moderator = moderator
        self.pulse = pulse
        self.clients: Set[Client] = set()

    def register(self) -> Client:
        client = Client(seen_seq=self.pipeline.seq)
        self.clients.add(client)
        return client

    def unregister(self, client: Client) -> None:
        self.clients.discard(client)

    def serialize(self, edit: Edit) -> Dict[str, Any]:
        flag = self.moderator.flag_for(edit.id) if self.moderator is not None else None
        return {**edit.to_dict(), "flag": flag.to_dict() if flag else None}

    def recent(self, wiki: Optional[str], limit: int = 200) -> List[Dict[str, Any]]:
        items = [self.serialize(e) for e in self.pipeline.recent if wiki is None or e.wiki == wiki]
        return items[-limit:]

    def flagged(self, wiki: Optional[str]) -> List[Dict[str, Any]]:
        return self.moderator.recent_flagged(wiki) if self.moderator is not None else []

    def initial_state(self, wiki: Optional[str]) -> Dict[str, Any]:
        """Everything a client needs to render from scratch."""
        return {
            "recent": self.recent(wiki),
            "flagged": self.flagged(wiki),
            "snapshot": self.stats.snapshot(wiki),
            "pulse": self.pulse.current if self.pulse is not None else None,
        }

    async def run(self) -> None:
        while True:
            await asyncio.sleep(self.interval)
            try:
                self.tick()
            except Exception:
                log.exception("tick failed")

    def tick(self) -> None:
        edits = [(seq, self.serialize(e)) for seq, e in self.pipeline.drain()]
        flag_updates = self.moderator.drain_updates() if self.moderator is not None else []
        pulse = self.pulse.take_update() if self.pulse is not None else None
        snapshots: Dict[Optional[str], Dict[str, Any]] = {}  # one per distinct filter

        for client in list(self.clients):
            wiki = client.wiki
            items = [
                e for seq, e in edits
                if seq > client.seen_seq and (wiki is None or e["wiki"] == wiki)
            ]
            if items:
                client.offer({"type": "edits", "items": items[-self.max_edits_per_tick:]})
            flags = [e for e in flag_updates if wiki is None or e["wiki"] == wiki]
            if flags:
                client.offer({"type": "flags", "items": flags})
            if pulse is not None:
                client.offer({"type": "pulse", "data": pulse})
            if wiki not in snapshots:
                snapshots[wiki] = self.stats.snapshot(wiki)
            client.offer({"type": "snapshot", "data": snapshots[wiki]})
