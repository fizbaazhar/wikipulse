"""The ``/ws`` live channel.

Protocol (JSON messages)
------------------------
server -> client
    {"type": "hello", "source": {...}, "ai": {...}, "recent": [edit...],
     "flagged": [edit...], "snapshot": {...}, "pulse": {...}}
    {"type": "edits",    "items": [edit...]}         every tick, if any
    {"type": "flags",    "items": [edit...]}         when a vandalism flag changes
    {"type": "pulse",    "data": {...}}              when the Pulse summary changes
    {"type": "snapshot", "data": {...}}              every tick
    {"type": "reset", "recent": [...], "flagged": [...], "snapshot": {...},
     "pulse": {...}}                                  after subscribe
    {"type": "error",    "message": "..."}

Every edit carries ``flag``: null, or
    {"status": "suspect|reviewing|flagged|cleared", "score": 0..1,
     "reason": "...", "signals": [...], "source": "rules|ai", ...}
client -> server
    {"type": "subscribe", "wiki": "enwiki" | null}   change the wiki filter

The session is checked when the socket opens; an open socket is not cut off
when the session later expires or the user signs out (fine for a dashboard).
"""
from __future__ import annotations

import asyncio
import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..wikis import validate_wiki
from .deps import current_user

router = APIRouter()

# Close code the browser treats as "sign in again".
WS_UNAUTHORIZED = 4401


@router.websocket("/ws")
async def live(ws: WebSocket) -> None:
    await ws.accept()
    if current_user(ws) is None:
        # Accept-then-close so the browser sees a clear "log in again" code.
        await ws.close(code=WS_UNAUTHORIZED, reason="login required")
        return
    state = ws.app.state
    hub = state.hub
    client = hub.register()

    async def writer() -> None:
        while True:
            await ws.send_json(await client.next_message())

    writer_task = asyncio.create_task(writer())
    try:
        client.offer({
            "type": "hello",
            "source": state.pipeline.source.status(),
            "ai": {"enabled": state.llm is not None, "model": getattr(state.llm, "model", None)},
            **hub.initial_state(None),
        })
        while True:
            text = await ws.receive_text()
            try:
                msg = json.loads(text)
                if not isinstance(msg, dict) or msg.get("type") != "subscribe":
                    raise ValueError("unknown message")
                client.wiki = validate_wiki(msg.get("wiki"))
            except (ValueError, json.JSONDecodeError) as exc:
                client.offer({"type": "error", "message": str(exc)})
                continue
            client.seen_seq = state.pipeline.seq
            client.offer({"type": "reset", "wiki": client.wiki, **hub.initial_state(client.wiki)})
    except WebSocketDisconnect:
        pass
    finally:
        hub.unregister(client)
        writer_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await writer_task
