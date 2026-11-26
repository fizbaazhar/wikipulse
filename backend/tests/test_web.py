"""Serving the built dashboard from the back end (WIKIPULSE_STATIC_DIR)."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings

from .conftest import line, replay_app


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><title>WikiPulse</title>", encoding="utf-8")
    (root / "assets" / "app-1234.js").write_text("console.log('hi')", encoding="utf-8")
    (root / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside the dashboard", encoding="utf-8")
    return root


def client_for(tmp_path: Path, **settings) -> TestClient:
    return TestClient(replay_app(tmp_path, [line()], **settings))


@pytest.mark.parametrize("path", ["/", "/login", "/dashboard", "/some/deep/link"])
def test_page_routes_get_the_dashboard(tmp_path, dist, path):
    with client_for(tmp_path, static_dir=dist) as client:
        response = client.get(path)
    assert response.status_code == 200
    assert "<title>WikiPulse</title>" in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_assets_and_root_files_are_served(tmp_path, dist):
    with client_for(tmp_path, static_dir=dist) as client:
        assert client.get("/assets/app-1234.js").text == "console.log('hi')"
        assert client.get("/favicon.svg").text == "<svg/>"
        assert client.get("/assets/missing.js").status_code == 404


def test_api_routes_keep_priority_and_unknown_api_paths_stay_404(tmp_path, dist):
    with client_for(tmp_path, static_dir=dist) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/nope").status_code == 404
        assert client.get("/api").status_code == 404


def test_websocket_still_works_with_the_dashboard_mounted(tmp_path, dist):
    with client_for(tmp_path, static_dir=dist) as client, client.websocket_connect("/ws") as socket:
        assert socket.receive_json()["type"] == "hello"


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"])
def test_files_outside_the_dashboard_are_never_served(tmp_path, dist, path):
    with client_for(tmp_path, static_dir=dist) as client:
        response = client.get(path)
    assert "outside the dashboard" not in response.text


def test_login_still_guards_the_api_but_not_the_page(tmp_path, dist):
    with client_for(tmp_path, static_dir=dist, auth_password="pw") as client:
        assert client.get("/dashboard").status_code == 200  # the page shows the login form itself
        assert client.get("/api/snapshot").status_code == 401


def test_without_static_dir_nothing_extra_is_served(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/dashboard").status_code == 404


def test_a_folder_without_index_html_is_ignored(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    with client_for(tmp_path, static_dir=empty) as client:
        assert client.get("/dashboard").status_code == 404


def test_static_dir_comes_from_the_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("WIKIPULSE_STATIC_DIR", str(tmp_path))
    assert Settings.from_env().static_dir == tmp_path
    monkeypatch.delenv("WIKIPULSE_STATIC_DIR")
    assert Settings.from_env().static_dir is None
