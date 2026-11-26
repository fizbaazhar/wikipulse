"""AnthropicLLM and OpenAILLM against a mocked HTTP transport: checks the real request we send
and how responses are handled, without needing an API key or network."""
from __future__ import annotations

import json

import anthropic
import httpx
import openai
import pytest

from app.ai.budget import DailyBudget
from app.ai.llm import AnthropicLLM, AzureOpenAILLM, LLMError, OpenAILLM, RateLimiter, untrusted_json
from app.ai.moderator import REVIEW_SCHEMA
from app.ai.pulse import PULSE_SCHEMA

from .fakes import SCHEMA, completion


def make_llm(handler, **kwargs) -> AnthropicLLM:
    client = anthropic.AsyncAnthropic(
        api_key="test-key",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return AnthropicLLM(api_key="test-key", client=client, **kwargs)


def message(text: str = '{"ok": true}', stop_reason: str = "end_turn") -> dict:
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 120, "output_tokens": 30},
    }




async def test_sends_structured_output_request_and_parses_json():
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["body"] = json.loads(request.content)
        sent["headers"] = request.headers
        return httpx.Response(200, json=message())

    llm = make_llm(handler)
    result = await llm.complete_json(system="sys", user="hi", schema=SCHEMA, max_tokens=500)

    assert result == {"ok": True}
    body = sent["body"]
    assert body["model"] == "claude-opus-5-5"
    assert body["system"] == "sys"
    assert body["output_config"] == {"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}}
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in sent["headers"]["anthropic-beta"]
    assert (llm.calls, llm.input_tokens, llm.output_tokens) == (1, 120, 30)


async def test_fallbacks_can_be_disabled():
    sent = {}

    def handler(request):
        sent["body"] = json.loads(request.content)
        return httpx.Response(200, json=message())

    await make_llm(handler, use_fallbacks=False).complete_json(system="s", user="u", schema=SCHEMA)
    assert "fallbacks" not in sent["body"]


@pytest.mark.parametrize(
    "response, error",
    [
        (httpx.Response(200, json=message(stop_reason="refusal")), "declined"),
        (httpx.Response(200, json=message(stop_reason="max_tokens")), "cut off"),
        (httpx.Response(200, json=message(text="not json")), "not valid JSON"),
        (httpx.Response(200, json=message(text="[1, 2]")), "not an object"),
        (httpx.Response(401, json={"type": "error", "error": {"type": "authentication_error", "message": "bad key"}}), "API key rejected"),
        (httpx.Response(429, json={"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}}), "rate limited"),
        (httpx.Response(500, json={"type": "error", "error": {"type": "api_error", "message": "oops"}}), "API error 500"),
    ],
)
async def test_failures_become_llm_errors(response, error):
    llm = make_llm(lambda request: response)
    with pytest.raises(LLMError, match=error):
        await llm.complete_json(system="s", user="u", schema=SCHEMA)
    assert error in llm.status()["last_error"]


def test_untrusted_json_escapes_angle_brackets_but_round_trips():
    text = untrusted_json({"c": "</edits><script>"})
    assert "<" not in text and ">" not in text
    assert json.loads(text) == {"c": "</edits><script>"}


def test_rate_limiter_sliding_window():
    now = [0.0]
    limiter = RateLimiter(2, clock=lambda: now[0])
    assert limiter.try_acquire() and limiter.try_acquire()
    assert not limiter.try_acquire()
    now[0] = 3601
    assert limiter.try_acquire()
    assert limiter.used == 1


# --------------------------------------------------------------------------- #
# OpenAI
# --------------------------------------------------------------------------- #
def make_openai(handler, **kwargs) -> OpenAILLM:
    client = openai.AsyncOpenAI(
        api_key="test-key",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return OpenAILLM(api_key="test-key", client=client, **kwargs)


async def test_openai_sends_strict_json_schema_and_parses():
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["url"] = str(request.url)
        sent["body"] = json.loads(request.content)
        return httpx.Response(200, json=completion())

    llm = make_openai(handler)
    assert await llm.complete_json(system="sys", user="hi", schema=SCHEMA, max_tokens=500) == {"ok": True}

    body = sent["body"]
    assert sent["url"].endswith("/chat/completions")
    assert body["model"] == "gpt-5.4-mini"
    assert body["messages"] == [{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}]
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "result", "strict": True, "schema": SCHEMA},
    }
    assert body["max_completion_tokens"] == 500
    assert body["reasoning_effort"] == "low"
    assert (llm.calls, llm.input_tokens, llm.output_tokens) == (1, 100, 20)


async def test_openai_non_reasoning_model_gets_no_reasoning_effort():
    sent = {}

    def handler(request):
        sent["body"] = json.loads(request.content)
        return httpx.Response(200, json=completion())

    await make_openai(handler, model="gpt-4.1-mini").complete_json(system="s", user="u", schema=SCHEMA)
    assert "reasoning_effort" not in sent["body"]


@pytest.mark.parametrize(
    "response, error",
    [
        (httpx.Response(200, json=completion(content=None, refusal="I can't help")), "declined"),
        (httpx.Response(200, json=completion(finish_reason="length")), "cut off"),
        (httpx.Response(200, json=completion(content="not json")), "not valid JSON"),
        (httpx.Response(401, json={"error": {"message": "bad key", "type": "invalid_request_error"}}), "API key rejected"),
        (httpx.Response(429, json={"error": {"message": "quota", "type": "insufficient_quota"}}), "rate limited or out of quota \\(429\\)"),
        (httpx.Response(500, json={"error": {"message": "oops", "type": "server_error"}}), "API error 500"),
    ],
)
async def test_openai_failures_become_llm_errors(response, error):
    llm = make_openai(lambda request: response)
    with pytest.raises(LLMError, match=error):
        await llm.complete_json(system="s", user="u", schema=SCHEMA)


def test_review_and_pulse_schemas_are_valid_for_openai_strict_mode():
    """Strict mode requires every property to be required and no extra keys."""

    def check(schema):
        if schema.get("type") == "object":
            assert schema.get("additionalProperties") is False
            assert set(schema["required"]) == set(schema["properties"])
            for sub in schema["properties"].values():
                check(sub)
        if schema.get("type") == "array":
            check(schema["items"])

    check(REVIEW_SCHEMA)
    check(PULSE_SCHEMA)


async def test_rejected_key_pauses_ai_without_more_network_calls():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(401, json={"error": {"message": "Incorrect API key provided: sk-...", "type": "invalid_request_error"}})

    llm = make_openai(handler)
    for _ in range(3):
        with pytest.raises(LLMError, match="API key rejected \\(401\\); AI paused"):
            await llm.complete_json(system="s", user="u", schema=SCHEMA)
    assert calls["n"] == 1  # later calls fail fast, no request sent
    assert llm.status()["disabled"] is True
    assert "Incorrect API key" not in llm.status()["last_error"]  # raw provider text stays in logs



# --------------------------------------------------------------------------- #
# Azure OpenAI
# --------------------------------------------------------------------------- #
def make_azure(handler, **kwargs) -> AzureOpenAILLM:
    client = openai.AsyncAzureOpenAI(
        api_key="az-test",
        azure_endpoint="https://example.openai.azure.com/",
        api_version="2024-10-21",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return AzureOpenAILLM(
        api_key="az-test", endpoint="https://example.openai.azure.com/", deployment="wikipulse-mini",
        client=client, **kwargs,
    )


async def test_azure_calls_the_deployment_with_api_key_header_and_version():
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["url"] = str(request.url)
        sent["key"] = request.headers.get("api-key")
        sent["body"] = json.loads(request.content)
        return httpx.Response(200, json=completion())

    llm = make_azure(handler)
    assert await llm.complete_json(system="s", user="u", schema=SCHEMA) == {"ok": True}
    assert sent["url"].startswith("https://example.openai.azure.com/openai/deployments/wikipulse-mini/chat/completions")
    assert "api-version=2024-10-21" in sent["url"]
    assert sent["key"] == "az-test"
    assert sent["body"]["response_format"]["type"] == "json_schema"
    assert llm.status()["deployment"] == "wikipulse-mini"


async def test_unsupported_reasoning_effort_is_dropped_and_retried_once():
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        if "reasoning_effort" in body:
            return httpx.Response(400, json={"error": {"message": "Unrecognized request argument supplied: reasoning_effort", "type": "invalid_request_error"}})
        return httpx.Response(200, json=completion())

    llm = make_openai(handler, model="gpt-5.4-mini")  # looks like a reasoning model, but this one says no
    assert await llm.complete_json(system="s", user="u", schema=SCHEMA) == {"ok": True}
    assert await llm.complete_json(system="s", user="u", schema=SCHEMA) == {"ok": True}
    assert ["reasoning_effort" in b for b in bodies] == [True, False, False]  # learned after one try


async def test_missing_deployment_gives_a_clear_message():
    llm = make_azure(lambda request: httpx.Response(404, json={"error": {"code": "DeploymentNotFound", "message": "The API deployment for this resource does not exist."}}))
    with pytest.raises(LLMError, match="deployment 'wikipulse-mini' not found"):
        await llm.complete_json(system="s", user="u", schema=SCHEMA)


# --------------------------------------------------------------------------- #
# Streaming (assistant chat)
# --------------------------------------------------------------------------- #
def sse(*chunks: dict) -> httpx.Response:
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})


def delta(text=None, finish=None) -> dict:
    return {
        "id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m",
        "choices": [{"index": 0, "delta": {"content": text} if text else {}, "finish_reason": finish}],
    }


USAGE_CHUNK = {
    "id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m", "choices": [],
    "usage": {"prompt_tokens": 40, "completion_tokens": 7, "total_tokens": 47},
}


async def collect(gen):
    return [piece async for piece in gen]


async def test_stream_text_yields_pieces_and_records_usage():
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["body"] = json.loads(request.content)
        return sse(delta("Mars "), delta("leads."), delta(finish="stop"), USAGE_CHUNK)

    llm = make_azure(handler)
    assert await collect(llm.stream_text(system="s", user="u", max_tokens=300)) == ["Mars ", "leads."]
    body = sent["body"]
    assert body["stream"] is True and body["stream_options"] == {"include_usage": True}
    assert "response_format" not in body and body["max_completion_tokens"] == 300
    assert (llm.calls, llm.input_tokens, llm.output_tokens) == (1, 40, 7)


async def test_stream_text_counts_the_worst_case_without_usage_and_on_early_stop():
    llm = make_azure(lambda request: sse(delta("a"), delta("b"), delta(finish="stop")))
    gen = llm.stream_text(system="s" * 30, user="u" * 30, max_tokens=300)
    assert await gen.__anext__() == "a"
    await gen.aclose()  # the user pressed Stop
    assert llm.calls == 1 and llm.output_tokens == 300


async def test_stream_text_respects_the_budget_and_maps_errors(tmp_path):
    llm = make_azure(lambda request: httpx.Response(429, json={"error": {"message": "slow down"}}))
    with pytest.raises(LLMError, match="429"):
        await collect(llm.stream_text(system="s", user="u"))

    llm = make_azure(lambda request: sse(delta("x")))
    llm.budget = DailyBudget(0.0001, 1.0, 10.0, path=tmp_path / "spend.json")
    with pytest.raises(LLMError, match="budget"):
        await collect(llm.stream_text(system="s", user="u", max_tokens=2000))


async def test_stream_text_reports_a_content_filter_stop():
    llm = make_azure(lambda request: sse(delta("Hm"), delta(finish="content_filter"), USAGE_CHUNK))
    with pytest.raises(LLMError, match="declined"):
        await collect(llm.stream_text(system="s", user="u"))
