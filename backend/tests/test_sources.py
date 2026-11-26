from __future__ import annotations

import json
from typing import AsyncIterator, List

import httpx

from app.sources.live import LiveSource, iter_sse
from app.sources.replay import ReplaySource

from .conftest import line


async def _aiter(items: List[str]) -> AsyncIterator[str]:
    for item in items:
        yield item


async def test_iter_sse_handles_comments_ids_and_multiline_data():
    raw = [
        ":ok",
        "",
        "event: message",
        "id: [{\"offset\":1}]",
        "data: {\"a\":",
        "data: 1}",
        "",
        "data: second",
        "",
    ]
    events = [e async for e in iter_sse(_aiter(raw))]
    assert [e.data for e in events] == ['{"a":\n1}', "second"]
    assert events[0].id == '[{"offset":1}]'
    assert events[0].event == "message"


async def test_live_source_yields_data_and_resumes_with_last_event_id():
    seen_headers = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers.get("last-event-id"))
        body = f"event: message\nid: cursor-{len(seen_headers)}\ndata: {line()}\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    source = LiveSource(url="https://example.test/stream", transport=httpx.MockTransport(handler))
    source.max_backoff = 0  # reconnect immediately in the test

    received = []
    async for data in source.lines():
        received.append(json.loads(data))
        if len(received) == 2:
            break

    assert len(received) == 2
    assert seen_headers[0] is None
    assert seen_headers[1] == "cursor-1"  # resumed from the last id
    assert source.reconnects >= 1


async def test_live_source_survives_http_errors():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, text=f"data: {line()}\n\n")

    source = LiveSource(url="https://example.test/stream", transport=httpx.MockTransport(handler))
    source.max_backoff = 0
    async for _ in source.lines():
        break
    assert calls["n"] == 2
    assert source.status()["reconnects"] == 1


async def test_replay_paces_by_timestamp_and_passes_bad_lines_through(tmp_path):
    path = tmp_path / "events.jsonl"
    path.write_text(
        "\n".join([
            line(timestamp=100),
            line(timestamp=110),
            "{not json",
            line(timestamp=105),  # out of order: no sleep
            line(timestamp=1000),  # huge gap: capped
        ]),
        encoding="utf-8",
    )
    sleeps: List[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    source = ReplaySource(path, speed=2.0, loop=False, max_gap=5.0, sleep=fake_sleep)
    out = [x async for x in source.lines()]

    assert len(out) == 5 and out[2] == "{not json"
    assert sleeps == [5.0, 5.0]  # (110-100)/2 = 5, then capped at max_gap


async def test_replay_loop_gives_new_ids_so_events_are_not_deduped(tmp_path):
    path = tmp_path / "events.jsonl"
    path.write_text(line(), encoding="utf-8")
    source = ReplaySource(path, speed=0, loop=True)
    ids = []
    async for item in source.lines():
        ids.append(json.loads(item)["meta"]["id"])
        if len(ids) == 3:
            break
    assert ids == ["evt-1", "evt-1#loop1", "evt-1#loop2"]
