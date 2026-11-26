"""End-to-end through the real app: replay source -> pipeline -> hub -> WebSocket."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from .conftest import line, replay_app
from .fakes import FakeLLM


@pytest.fixture
def client(tmp_path):
    rows = [
        line(meta={"id": "1"}, title="Mars", wiki="enwiki"),
        line(meta={"id": "2"}, title="Mars", wiki="enwiki"),
        line(meta={"id": "2"}, title="Mars", wiki="enwiki"),  # duplicate
        line(meta={"id": "3"}, title="Paris", wiki="frwiki", server_name="fr.wikipedia.org"),
        '{"broken',
        line(meta={"id": "4"}, type="log"),
    ]
    with TestClient(replay_app(tmp_path, rows)) as test_client:
        deadline = time.time() + 2
        while test_client.app.state.pipeline.counters["received"] < len(rows) and time.time() < deadline:
            time.sleep(0.01)
        yield test_client


def test_health_reports_every_outcome(client):
    body = client.get("/api/health").json()
    assert body["source"] == "replay"
    assert body["counters"] == {
        "received": 6,
        "accepted": 3,
        "duplicates": 1,
        "skipped_malformed_json": 1,
        "skipped_ignored_type": 1,
    }


def test_snapshot_endpoint_and_filter(client):
    top = client.get("/api/snapshot").json()["top_pages"][0]
    assert sum(top.pop("trend")) == 2
    assert top == {
        "wiki": "enwiki",
        "title": "Mars",
        "count": 2,
        "url": "https://en.wikipedia.org/wiki/Mars",
    }
    fr = client.get("/api/snapshot", params={"wiki": "frwiki"}).json()
    assert [p["title"] for p in fr["top_pages"]] == ["Paris"]


def test_snapshot_rejects_bad_wiki_param(client):
    assert client.get("/api/snapshot", params={"wiki": "<script>"}).status_code == 422


def test_websocket_hello_then_snapshots(client):
    with client.websocket_connect("/ws") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        assert len(hello["recent"]) == 3
        assert hello["snapshot"]["edits_in_window"] == 3
        assert ws.receive_json()["type"] == "snapshot"


def test_websocket_subscribe_filters_by_wiki(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # hello
        ws.send_json({"type": "subscribe", "wiki": "frwiki"})
        msg = ws.receive_json()
        while msg["type"] != "reset":
            msg = ws.receive_json()
        assert [e["title"] for e in msg["recent"]] == ["Paris"]
        assert msg["snapshot"]["wiki"] == "frwiki"


def test_websocket_rejects_invalid_messages(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # hello
        ws.send_text("not json")
        ws.send_json({"type": "subscribe", "wiki": "../../etc"})
        errors = []
        while len(errors) < 2:
            msg = ws.receive_json()
            if msg["type"] == "error":
                errors.append(msg)
        assert len(errors) == 2


def test_ai_verdict_reaches_the_browser(tmp_path):
    """Replay → rules flag → (fake) AI verdict → `flags` message on the WebSocket."""
    rows = [
        line(meta={"id": "ok"}, comment="Fixed a typo"),
        line(meta={"id": "bad"}, length={"old": 8000, "new": 10}, comment=""),
    ]
    llm = FakeLLM(lambda call: {"verdicts": [
        {"id": "e1", "vandalism": True, "confidence": 0.9, "reason": "Page was blanked"},
    ]})
    app = replay_app(tmp_path, rows, llm=llm, review_interval=0.05, pulse_interval=3600)

    with TestClient(app) as test_client:
        with test_client.websocket_connect("/ws") as ws:
            hello = ws.receive_json()
            assert hello["ai"]["enabled"] is True
            assert "pulse" in hello and "flagged" in hello
            deadline = time.time() + 3
            verdict = None
            while verdict is None and time.time() < deadline:
                msg = ws.receive_json()
                if msg["type"] == "flags":
                    verdict = msg["items"][0]
        assert verdict["id"] == "bad"
        assert verdict["flag"]["status"] == "flagged"
        assert verdict["flag"]["source"] == "ai"
        assert verdict["flag"]["reason"] == "Page was blanked"

        health = test_client.get("/api/health").json()
        assert health["ai"]["calls_this_hour"] == 1
        flagged = test_client.get("/api/flagged").json()["items"]
        assert [e["id"] for e in flagged] == ["bad"]
