"""Replay source: plays a recorded ``.jsonl`` file as if it were the live stream.

Used for offline development, demos without network, and deterministic tests.
Lines are passed through *unchanged* (malformed ones included) so the real
parser handles them exactly as it would live data.

Pacing follows the gaps between event timestamps, divided by ``speed``.
Out-of-order events are emitted immediately, and a single gap is capped at
``max_gap`` seconds so a bad timestamp cannot stall the replay.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Optional

from ..parser import normalize_timestamp


def _peek_timestamp(line: str) -> Optional[float]:
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, dict):
        return None
    meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    return normalize_timestamp(raw.get("timestamp"), meta.get("dt"))


def _tag_for_loop(line: str, loop_index: int) -> str:
    """Give replayed events new ids on each loop so the deduper keeps them."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return line
    meta = raw.get("meta") if isinstance(raw, dict) else None
    if isinstance(meta, dict) and isinstance(meta.get("id"), str):
        meta["id"] = f"{meta['id']}#loop{loop_index}"
        return json.dumps(raw, ensure_ascii=False)
    return line


class ReplaySource:
    name = "replay"

    def __init__(
        self,
        path: Path,
        speed: float = 1.0,
        loop: bool = True,
        max_gap: float = 5.0,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    ) -> None:
        self.path = Path(path)
        self.speed = speed
        self.loop = loop
        self.max_gap = max_gap
        self._sleep = sleep
        self.loops_completed = 0
        self.lines_emitted = 0

    async def lines(self) -> AsyncIterator[str]:
        while True:
            last_ts: Optional[float] = None
            with self.path.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    ts = _peek_timestamp(line)
                    if self.speed > 0 and ts is not None and last_ts is not None and ts > last_ts:
                        await self._sleep(min((ts - last_ts) / self.speed, self.max_gap))
                    else:
                        await asyncio.sleep(0)  # let other tasks run
                    if ts is not None and (last_ts is None or ts > last_ts):
                        last_ts = ts
                    if self.loops_completed:
                        line = _tag_for_loop(line, self.loops_completed)
                    self.lines_emitted += 1
                    yield line
            self.loops_completed += 1
            if not self.loop:
                return

    def status(self) -> Dict[str, Any]:
        return {
            "source": self.name,
            "file": self.path.name,
            "speed": self.speed,
            "loop": self.loop,
            "connected": True,
            "loops_completed": self.loops_completed,
            "lines_emitted": self.lines_emitted,
        }
