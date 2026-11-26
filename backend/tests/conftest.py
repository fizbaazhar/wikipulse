from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import pytest
from fastapi import FastAPI

from app.config import Settings
from app.main import create_app
from app.sources.replay import ReplaySource

SAMPLE_FILE = Path(__file__).resolve().parent.parent / "data" / "sample_events.jsonl"


def make_event(**overrides: Any) -> Dict[str, Any]:
    """A valid recentchange 'edit' event; override any field."""
    event: Dict[str, Any] = {
        "$schema": "/mediawiki/recentchange/1.0.0",
        "meta": {"id": "evt-1", "dt": "2026-11-18T10:00:00Z", "domain": "en.wikipedia.org"},
        "id": 1001,
        "type": "edit",
        "namespace": 0,
        "title": "Mars",
        "title_url": "https://en.wikipedia.org/wiki/Mars",
        "comment": "Fixed spelling",
        "timestamp": 1794996000,
        "user": "Alice",
        "bot": False,
        "server_url": "https://en.wikipedia.org",
        "server_name": "en.wikipedia.org",
        "wiki": "enwiki",
        "minor": False,
        "length": {"old": 1000, "new": 1100},
        "revision": {"old": 10, "new": 11},
    }
    event.update(overrides)
    return event


def line(**overrides: Any) -> str:
    return json.dumps(make_event(**overrides))


class FakeClock:
    def __init__(self, start: float = 1_800_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


def replay_app(tmp_path: Path, rows: Iterable[str], llm: Optional[Any] = None, **settings: Any) -> FastAPI:
    """The real app, fed ``rows`` (JSON lines) once from a replay file instead of the live stream."""
    path = tmp_path / "events.jsonl"
    path.write_text("\n".join(rows), encoding="utf-8")
    config = Settings(source="replay", **{"tick_seconds": 0.05, **settings})
    return create_app(config, source=ReplaySource(path, speed=0, loop=False), llm=llm)
