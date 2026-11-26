from __future__ import annotations

from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Union

from app.ai.llm import LLMError

Responder = Callable[[Dict[str, Any]], Union[Dict[str, Any], Exception]]


class FakeLLM:
    """Records every call and answers with a canned response or a function."""

    name = "fake"
    model = "fake-model"

    def __init__(self, respond: Optional[Responder] = None) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.respond = respond or (lambda call: {})

    async def complete_json(self, *, system: str, user: str, schema: Dict[str, Any], max_tokens: int) -> Dict[str, Any]:
        call = {"system": system, "user": user, "schema": schema, "max_tokens": max_tokens}
        self.calls.append(call)
        result = self.respond(call)
        if isinstance(result, Exception):
            raise result
        return result


class FakeStreamingLLM(FakeLLM):
    """Also streams: ``respond`` returns the list of text pieces (or an exception)."""

    async def stream_text(self, *, system: str, user: str, max_tokens: int = 2000) -> AsyncIterator[str]:
        call = {"system": system, "user": user, "max_tokens": max_tokens, "stream": True}
        self.calls.append(call)
        result = self.respond(call)
        if isinstance(result, Exception):
            raise result
        for piece in result:
            if isinstance(piece, Exception):
                raise piece
            yield piece


def failing(message: str = "boom") -> Responder:
    return lambda call: LLMError(message)


# A tiny JSON schema and an OpenAI chat completion body, for the real-client tests.
SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}


def completion(content='{"ok": true}', finish_reason="stop", refusal=None) -> dict:
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": 0,
        "model": "gpt-5.4-mini",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": content, "refusal": refusal},
            "finish_reason": finish_reason,
        }],
        "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
    }
