"""Login: signed sessions, protected REST + WebSocket, throttling."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.ws import WS_UNAUTHORIZED
from app.auth import COOKIE_NAME, Auth, LoginThrottle

from .conftest import line, replay_app


# ----------------------------------------------------------------- unit


def test_tokens_round_trip_and_expire(clock):
    auth = Auth("admin", "pw", secret="s", session_hours=1, clock=clock)
    token = auth.issue("admin")
    assert auth.verify(token) == "admin"
    clock.advance(3601)
    assert auth.verify(token) is None


@pytest.mark.parametrize("mangle", [
    lambda t: t[:-1] + ("0" if t[-1] != "0" else "1"),   # signature changed
    lambda t: "eA" + t,                                   # payload changed
    lambda t: t.replace(".", ""),                          # malformed
    lambda t: "",
])
def test_tampered_tokens_are_rejected(clock, mangle):
    auth = Auth("admin", "pw", secret="s", clock=clock)
    assert auth.verify(mangle(auth.issue("admin"))) is None


def test_token_from_another_secret_is_rejected(clock):
    a = Auth("admin", "pw", secret="one", clock=clock)
    b = Auth("admin", "pw", secret="two", clock=clock)
    assert b.verify(a.issue("admin")) is None


def test_password_check():
    auth = Auth("admin", "s3cret")
    assert auth.check_password("admin", "s3cret")
    assert not auth.check_password("admin", "wrong")
    assert not auth.check_password("root", "s3cret")
    assert not Auth("admin", None).check_password("admin", "")


def test_throttle_blocks_then_recovers(clock):
    t = LoginThrottle(max_failures=3, window=60, clock=clock)
    for _ in range(3):
        assert not t.blocked("ip")
        t.fail("ip")
    assert t.blocked("ip") and not t.blocked("other")
    assert 1 <= t.retry_after("ip") <= 61
    clock.advance(61)
    assert not t.blocked("ip")


# ------------------------------------------------------------------ API


@pytest.fixture
def app_client(tmp_path):
    app = replay_app(tmp_path, [line(meta={"id": "1"})], auth_username="admin", auth_password="s3cret")
    with TestClient(app) as client:
        yield client


def login(client, password="s3cret"):
    return client.post("/api/auth/login", json={"username": "admin", "password": password})


def test_api_needs_a_session(app_client):
    assert app_client.get("/api/snapshot").status_code == 401
    assert app_client.post("/api/pulse/refresh").status_code == 401
    assert app_client.get("/api/auth/me").json() == {"auth_enabled": True, "user": None}
    # Health stays reachable for container checks, but without details.
    assert app_client.get("/api/health").json() == {"status": "ok"}


def test_login_sets_a_safe_cookie_and_unlocks_the_api(app_client):
    res = login(app_client)
    assert res.status_code == 200 and res.json()["user"] == "admin"
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert app_client.get("/api/snapshot").status_code == 200
    assert "counters" in app_client.get("/api/health").json()
    assert app_client.get("/api/auth/me").json()["user"] == "admin"


def test_wrong_password_and_logout(app_client):
    res = login(app_client, "nope")
    assert res.status_code == 401 and COOKIE_NAME not in app_client.cookies
    login(app_client)
    app_client.post("/api/auth/logout")
    app_client.cookies.clear()  # the client honours the expired cookie the server sent
    assert app_client.get("/api/snapshot").status_code == 401


def test_repeated_failures_are_throttled(app_client):
    for _ in range(5):
        assert login(app_client, "nope").status_code == 401
    res = login(app_client)  # even the right password waits
    assert res.status_code == 429 and int(res.headers["retry-after"]) > 0


def test_forged_cookie_is_rejected(app_client):
    app_client.cookies.set(COOKIE_NAME, "YWRtaW58OTk5OTk5OTk5OQ==.deadbeef")
    assert app_client.get("/api/snapshot").status_code == 401


def test_websocket_requires_login(app_client):
    with app_client.websocket_connect("/ws") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == WS_UNAUTHORIZED

    login(app_client)
    with app_client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "hello"


def test_login_is_off_without_a_password(tmp_path):
    with TestClient(replay_app(tmp_path, [line(meta={"id": "1"})])) as client:
        assert client.get("/api/snapshot").status_code == 200
        assert client.get("/api/auth/me").json() == {"auth_enabled": False, "user": None}


def test_a_cookie_with_non_ascii_text_is_rejected_not_an_error():
    auth = Auth("admin", "pw")
    assert auth.verify("abc.é") is None
    assert auth.verify("é.abc") is None
