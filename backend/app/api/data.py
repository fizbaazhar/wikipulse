"""Read-only REST views of the live data (the WebSocket pushes the same data)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from .ai import ai_status
from .deps import WikiFilter, current_user

router = APIRouter(prefix="/api")


@router.get("/health")
async def health(request: Request) -> dict:
    if current_user(request) is None:
        return {"status": "ok"}  # liveness only; details need a session
    state = request.app.state
    return {"status": "ok", "clients": len(state.hub.clients), "ai": ai_status(state), **state.pipeline.status()}


@router.get("/snapshot")
async def snapshot(request: Request, wiki: Optional[str] = WikiFilter) -> dict:
    return request.app.state.stats.snapshot(wiki)


@router.get("/recent")
async def recent(request: Request, wiki: Optional[str] = WikiFilter, limit: int = Query(50, ge=1, le=200)) -> dict:
    return {"items": request.app.state.hub.recent(wiki, limit)}


@router.get("/flagged")
async def flagged(request: Request, wiki: Optional[str] = WikiFilter) -> dict:
    return {"items": request.app.state.hub.flagged(wiki)}
