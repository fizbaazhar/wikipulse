from __future__ import annotations

import asyncio

from app.hub import Client, Hub
from app.pipeline import Pipeline
from app.stats import RollingStats

from .conftest import line


class _NoSource:
    name = "none"

    def status(self):
        return {}


def _messages(client: Client):
    return client.drain()


def _setup(clock):
    stats = RollingStats(clock=clock)
    pipeline = Pipeline(_NoSource(), stats)
    return pipeline, Hub(pipeline, stats)


async def test_new_client_does_not_get_edits_it_already_has(clock):
    pipeline, hub = _setup(clock)
    pipeline.process_line(line(meta={"id": "a"}))  # pending, and in `recent`
    client = hub.register()  # hello would include edit "a"
    pipeline.process_line(line(meta={"id": "b"}))

    hub.tick()
    edits = [m for m in _messages(client) if m["type"] == "edits"]
    assert [e["id"] for e in edits[0]["items"]] == ["b"]


async def test_tick_filters_by_wiki_and_always_sends_snapshot(clock):
    pipeline, hub = _setup(clock)
    client = hub.register()
    client.wiki = "frwiki"
    pipeline.process_line(line(meta={"id": "en"}, wiki="enwiki"))

    hub.tick()
    msgs = _messages(client)
    assert [m["type"] for m in msgs] == ["snapshot"]
    assert msgs[0]["data"]["wiki"] == "frwiki"


async def test_slow_client_drops_oldest_edits_first():
    client = Client(queue_size=2)
    for i in range(5):
        client.offer({"type": "edits", "n": i})
    assert [m["n"] for m in _messages(client)] == [3, 4]
    assert client.dropped == 3


async def test_slow_client_never_loses_reset_or_flags():
    client = Client(queue_size=2)
    client.offer({"type": "reset", "wiki": "frwiki"})
    client.offer({"type": "flags", "items": ["verdict"]})
    for i in range(10):
        client.offer({"type": "edits", "n": i})
    kinds = [m["type"] for m in _messages(client)]
    assert kinds[:2] == ["reset", "flags"]
    assert kinds.count("edits") == 0  # only edits were sacrificed


async def test_only_latest_snapshot_and_pulse_are_kept():
    client = Client()
    for i in range(5):
        client.offer({"type": "snapshot", "n": i})
        client.offer({"type": "pulse", "n": i})
    msgs = _messages(client)
    assert [(m["type"], m["n"]) for m in msgs] == [("snapshot", 4), ("pulse", 4)]


async def test_reset_discards_messages_for_the_old_view():
    client = Client()
    client.offer({"type": "edits", "items": ["old wiki"]})
    client.offer({"type": "snapshot", "data": "old"})
    client.offer({"type": "reset", "wiki": "frwiki"})
    assert [m["type"] for m in _messages(client)] == ["reset"]


async def test_next_message_waits_for_an_offer():
    client = Client()
    waiter = asyncio.ensure_future(client.next_message())
    await asyncio.sleep(0)
    assert not waiter.done()
    client.offer({"type": "pulse"})
    assert (await asyncio.wait_for(waiter, 1))["type"] == "pulse"
