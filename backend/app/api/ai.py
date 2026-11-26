"""AI routes: the Pulse summary and the chat assistant."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, List, Literal, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..ai.assistant import MAX_QUESTION_CHARS, SUGGESTIONS
from ..wikis import WIKI_ID_PATTERN

router = APIRouter(prefix="/api")


def ai_status(state: Any) -> dict:
    """AI on/off, spend and call counts, for ``/api/health``."""
    model = state.llm
    budget = getattr(model, "budget", None)
    return {
        "enabled": model is not None,
        "budget": budget.status() if budget is not None else None,
        "model": getattr(model, "model", None),
        "calls_this_hour": state.limiter.used,
        "max_calls_per_hour": state.limiter.max_per_hour,
        "chat_calls_this_hour": state.chat_limiter.used,
        "max_chat_calls_per_hour": state.chat_limiter.max_per_hour,
        "llm": model.status() if hasattr(model, "status") else None,
        "moderation": state.moderator.status(),
    }


@router.get("/pulse")
async def get_pulse(request: Request) -> dict:
    return request.app.state.pulse.current


@router.post("/pulse/refresh")
async def refresh_pulse(request: Request) -> dict:
    refreshed, pulse = await request.app.state.pulse.manual_refresh()
    return {"refreshed": refreshed, "pulse": pulse}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatBody(BaseModel):
    """The conversation so far; the last message is the new question."""

    messages: List[ChatMessage] = Field(min_length=1, max_length=20)
    wiki: Optional[str] = Field(None, pattern=WIKI_ID_PATTERN)


@router.get("/assistant")
async def assistant_info(request: Request) -> dict:
    return {"ai_enabled": request.app.state.llm is not None, "suggestions": SUGGESTIONS}


@router.post("/assistant/chat")
async def assistant_chat(body: ChatBody, request: Request) -> Any:
    *history, question = body.messages
    if question.role != "user" or len(question.content) > MAX_QUESTION_CHARS:
        return JSONResponse(
            {"detail": f"The last message must be your question, up to {MAX_QUESTION_CHARS} characters."},
            status_code=422,
        )
    events = request.app.state.assistant.stream(
        question.content, [m.model_dump() for m in history], wiki=body.wiki
    )

    async def ndjson() -> AsyncIterator[bytes]:
        async for event in events:
            yield (json.dumps(event, ensure_ascii=False) + "\n").encode()

    # One JSON event per line, sent as the model writes (ChatGPT-style).
    # X-Accel-Buffering stops nginx holding the stream back.
    return StreamingResponse(
        ndjson(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
