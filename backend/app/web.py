"""Serve the built dashboard from the back end (single-service deploys).

Docker Compose serves the dashboard with nginx. A host that runs one container
(e.g. Render) can instead set ``WIKIPULSE_STATIC_DIR`` to the dashboard's
``dist`` folder, and the API, the WebSocket and the page share one origin.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger("wikipulse")


def mount_dashboard(app: FastAPI, root: Path) -> bool:
    """Serve ``root`` at ``/``; unknown paths get ``index.html`` (the app routes itself).

    Must be called after the API routers, so they keep priority. Returns False
    (and serves nothing) when ``root`` has no ``index.html``.
    """
    root = root.resolve()
    index = root / "index.html"
    if not index.is_file():
        log.warning("WIKIPULSE_STATIC_DIR=%s has no index.html; not serving the dashboard", root)
        return False

    if (root / "assets").is_dir():
        # Vite puts a content hash in every asset name, so they can be cached for good.
        app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def dashboard(path: str) -> FileResponse:
        if path == "api" or path.startswith(("api/", "ws")):
            raise HTTPException(status_code=404)  # an unknown API route stays a 404, not a page
        if path:
            candidate = (root / path).resolve()
            if candidate.is_file() and candidate.is_relative_to(root):  # never outside root
                return FileResponse(candidate)
        # The page itself must not be cached, or a deploy would keep old asset names.
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    log.info("Serving the dashboard from %s", root)
    return True
