"""Thin LLM layer, so the rest of the app never depends on a specific provider.

``LLMClient.complete_json`` returns schema-validated JSON (Pulse, vandalism
review); ``OpenAILLM.stream_text`` streams the chat assistant's plain-text
answers. Implementations, each using its provider's official SDK:

* ``OpenAILLM``: OpenAI Chat Completions with strict JSON-schema output
* ``AzureOpenAILLM``: the same, against an Azure OpenAI deployment
* ``AnthropicLLM``: Claude Messages API with JSON-schema output

Cost and safety controls live here too:
* ``RateLimiter``: hard cap on calls per hour (one for background work, one
  for the chat), on top of the daily dollar ``DailyBudget``.
* Structured output (JSON schema) for background work, so model output is
  data we validate, never free text we act on.
"""
from __future__ import annotations

import json
import logging
import time
from collections import deque
from typing import Any, AsyncIterator, Callable, Deque, Dict, Optional, Protocol

from .budget import CHARS_PER_TOKEN, BudgetExceeded, DailyBudget

log = logging.getLogger(__name__)

DEFAULT_MODELS = {"openai": "gpt-5.4-mini", "anthropic": "claude-opus-5-5", "azure": ""}
# GA Azure OpenAI API version with structured outputs (JSON schema).
DEFAULT_AZURE_API_VERSION = "2024-10-21"


class LLMError(RuntimeError):
    """The model call failed or returned something unusable."""


def as_llm_error(exc: BaseException) -> LLMError:
    """An ``LLMError`` as it is; anything else (a bug in an SDK) is logged and wrapped."""
    if isinstance(exc, LLMError):
        return exc
    log.error("unexpected error from the LLM client", exc_info=exc)
    return LLMError("unexpected error")


class LLMClient(Protocol):
    name: str

    async def complete_json(
        self, *, system: str, user: str, schema: Dict[str, Any], max_tokens: int
    ) -> Dict[str, Any]: ...


class RateLimiter:
    """Sliding-window limit on calls per hour."""

    def __init__(self, max_per_hour: int, clock: Callable[[], float] = time.monotonic) -> None:
        self.max_per_hour = max_per_hour
        self._clock = clock
        self._calls: Deque[float] = deque()

    def _trim(self) -> None:
        cutoff = self._clock() - 3600
        while self._calls and self._calls[0] <= cutoff:
            self._calls.popleft()

    def try_acquire(self) -> bool:
        self._trim()
        if len(self._calls) >= self.max_per_hour:
            return False
        self._calls.append(self._clock())
        return True

    @property
    def used(self) -> int:
        self._trim()
        return len(self._calls)


class _BaseLLM:
    """Shared bookkeeping: usage counters, error reporting, JSON parsing."""

    name = "base"

    def __init__(self, model: str) -> None:
        self.model = model
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.last_error: Optional[str] = None
        # Set when the key is rejected: retrying cannot succeed, so stop calling.
        self.disabled_reason: Optional[str] = None
        # Optional daily dollar limit, shared by every AI feature.
        self.budget: Optional[DailyBudget] = None

    def _start_call(self, prompt_chars: int = 0, max_tokens: int = 0) -> float:
        """Check the call may go ahead; returns the budget held for it (see ``DailyBudget``)."""
        if self.disabled_reason:
            raise LLMError(self.disabled_reason)
        if self.budget is None:
            return 0.0
        try:
            return self.budget.reserve(prompt_chars, max_tokens)
        except BudgetExceeded as exc:
            self.last_error = str(exc)
            raise LLMError(str(exc)) from None

    def _cancel_call(self, held: float) -> None:
        """The request never went through: nothing was used."""
        if self.budget is not None:
            self.budget.release(held)

    def _record_usage(self, input_tokens: Optional[int], output_tokens: Optional[int], held: float = 0.0) -> None:
        self.calls += 1
        self.input_tokens += input_tokens or 0
        self.output_tokens += output_tokens or 0
        if self.budget is not None:
            self.budget.record(input_tokens or 0, output_tokens or 0, held)

    def _parse(self, text: Optional[str]) -> Dict[str, Any]:
        if not text:
            raise self._fail("no text in response")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise self._fail("response was not valid JSON") from exc
        if not isinstance(data, dict):
            raise self._fail("response JSON was not an object")
        self.last_error = None
        return data

    def _fail(self, message: str, detail: Any = None) -> LLMError:
        """Short ``message`` for the UI; full ``detail`` only in the server log."""
        self.last_error = message
        log.warning("LLM call failed: %s%s", message, f" ({detail})" if detail else "")
        return LLMError(message)

    def _auth_failed(self, status: int, detail: Any) -> LLMError:
        self.disabled_reason = f"API key rejected ({status}); AI paused until restart"
        return self._fail(self.disabled_reason, detail)

    def status(self) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "model": self.model,
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "last_error": self.last_error,
            "disabled": self.disabled_reason is not None,
        }


class OpenAILLM(_BaseLLM):
    """OpenAI via the official ``openai`` SDK, with strict JSON-schema output."""

    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODELS["openai"],
        effort: Optional[str] = "low",
        timeout: float = 30.0,
        client: Any = None,
    ) -> None:
        import openai  # imported lazily so the app runs without the package

        super().__init__(model)
        self.effort = effort
        self._openai = openai
        self._client = client or openai.AsyncOpenAI(api_key=api_key, timeout=timeout, max_retries=2)

    @property
    def _is_reasoning_model(self) -> bool:
        # Only reasoning models accept `reasoning_effort`; others reject it.
        # A wrong guess (e.g. an Azure deployment with a custom name) is
        # corrected automatically in `_create`.
        return self.model.startswith(("gpt-5", "o1", "o3", "o4"))

    async def _create(self, kwargs: Dict[str, Any]) -> Any:
        try:
            return await self._client.chat.completions.create(**kwargs)
        except self._openai.BadRequestError as exc:
            if "reasoning_effort" in kwargs and "reasoning_effort" in str(exc.message):
                # This model/deployment does not take reasoning_effort: stop sending it.
                log.info("model %s does not accept reasoning_effort; retrying without it", self.model)
                self.effort = None
                kwargs = {k: v for k, v in kwargs.items() if k != "reasoning_effort"}
                return await self._client.chat.completions.create(**kwargs)
            raise

    def _request(self, system: str, user: str, max_tokens: int, **extra: Any) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = dict(
            model=self.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_completion_tokens=max_tokens,
            **extra,
        )
        if self.effort and self._is_reasoning_model:
            kwargs["reasoning_effort"] = self.effort
        return kwargs

    async def _send(self, kwargs: Dict[str, Any], held: float) -> Any:
        """Send the request; on failure give the held budget back and raise ``LLMError``."""
        try:
            return await self._create(kwargs)
        except BaseException as exc:
            self._cancel_call(held)
            if isinstance(exc, self._openai.APIError):
                raise self._map_error(exc) from exc
            raise

    def _record(self, usage: Any, held: float) -> None:
        self._record_usage(getattr(usage, "prompt_tokens", 0), getattr(usage, "completion_tokens", 0), held)

    async def complete_json(
        self, *, system: str, user: str, schema: Dict[str, Any], max_tokens: int = 4000
    ) -> Dict[str, Any]:
        kwargs = self._request(
            system, user, max_tokens,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "result", "strict": True, "schema": schema},
            },
        )
        held = self._start_call(len(system) + len(user), max_tokens)
        response = await self._send(kwargs, held)
        self._record(getattr(response, "usage", None), held)

        if not response.choices:
            raise self._fail("no choices in response")
        choice = response.choices[0]
        if getattr(choice.message, "refusal", None):
            raise self._fail("model declined the request")
        if choice.finish_reason == "length":
            raise self._fail("response was cut off (max tokens)")
        return self._parse(choice.message.content)

    def _map_error(self, exc: Exception) -> LLMError:
        o = self._openai
        if isinstance(exc, o.RateLimitError):
            return self._fail("rate limited or out of quota (429)", exc.message)
        if isinstance(exc, (o.AuthenticationError, o.PermissionDeniedError)):
            return self._auth_failed(exc.status_code, exc.message)
        if isinstance(exc, o.NotFoundError):
            return self._fail(f"model or deployment '{self.model}' not found (404)", exc.message)
        if isinstance(exc, o.APIStatusError):
            return self._fail(f"API error {exc.status_code}", exc.message)
        if isinstance(exc, o.APIConnectionError):
            return self._fail("network error", exc)
        return self._fail("API error", exc)

    async def stream_text(self, *, system: str, user: str, max_tokens: int = 2000) -> AsyncIterator[str]:
        """Plain-text answer, yielded piece by piece as the model writes it.

        Usage is recorded against the budget when the stream ends, even if the
        caller stops early (e.g. the user pressed Stop). If the provider sends
        no usage figures, the worst case (all ``max_tokens``) is recorded.
        """
        kwargs = self._request(system, user, max_tokens, stream=True, stream_options={"include_usage": True})
        held = self._start_call(len(system) + len(user), max_tokens)
        stream = await self._send(kwargs, held)

        usage: Any = None
        finish: Optional[str] = None
        try:
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    usage = chunk.usage
                for choice in chunk.choices or []:
                    if choice.finish_reason:
                        finish = choice.finish_reason
                    text = getattr(choice.delta, "content", None) if choice.delta else None
                    if text:
                        yield text
        except self._openai.APIError as exc:
            raise self._map_error(exc) from exc
        finally:
            if usage is not None:
                self._record(usage, held)
            else:
                self._record_usage((len(system) + len(user)) // CHARS_PER_TOKEN + 1, max_tokens, held)
            close = getattr(stream, "close", None)
            if close is not None:
                try:
                    await close()
                except Exception:  # closing is best effort
                    pass
        if finish == "content_filter":
            raise self._fail("model declined the request")
        if finish != "length":
            self.last_error = None


class AzureOpenAILLM(OpenAILLM):
    """Azure OpenAI: same requests as ``OpenAILLM``, sent to a deployment.

    On Azure the ``model`` field is the *deployment name* chosen in the Azure
    portal, not the underlying model's name.
    """

    name = "azure"

    def __init__(
        self,
        api_key: str,
        endpoint: str,
        deployment: str,
        api_version: str = DEFAULT_AZURE_API_VERSION,
        effort: Optional[str] = "low",
        timeout: float = 30.0,
        client: Any = None,
    ) -> None:
        import openai

        client = client or openai.AsyncAzureOpenAI(
            api_key=api_key,
            azure_endpoint=endpoint,
            api_version=api_version,
            timeout=timeout,
            max_retries=2,
        )
        super().__init__(api_key=api_key, model=deployment, effort=effort, timeout=timeout, client=client)
        self.api_version = api_version

    def status(self) -> Dict[str, Any]:
        return {**super().status(), "deployment": self.model, "api_version": self.api_version}


class AnthropicLLM(_BaseLLM):
    """Claude via the official ``anthropic`` SDK, with JSON-schema structured output."""

    name = "anthropic"

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODELS["anthropic"],
        effort: str = "low",
        timeout: float = 30.0,
        use_fallbacks: bool = True,
        client: Any = None,
    ) -> None:
        import anthropic  # imported lazily so the app runs without the package

        super().__init__(model)
        self.effort = effort
        self.use_fallbacks = use_fallbacks
        self._anthropic = anthropic
        self._client = client or anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout, max_retries=2)

    async def complete_json(
        self, *, system: str, user: str, schema: Dict[str, Any], max_tokens: int = 4000
    ) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = dict(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            # Low effort: these are short classification / summary tasks.
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
        )
        if self.use_fallbacks:
            # If a safety classifier declines (e.g. on hostile edit text), the
            # API retries on a fallback model inside the same call.
            kwargs.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")

        held = self._start_call(len(system) + len(user), max_tokens)
        a = self._anthropic
        try:
            response = await self._client.beta.messages.create(**kwargs)
        except BaseException as exc:
            self._cancel_call(held)
            if isinstance(exc, a.RateLimitError):
                raise self._fail("rate limited (429)", exc.message) from exc
            if isinstance(exc, (a.AuthenticationError, a.PermissionDeniedError)):
                raise self._auth_failed(exc.status_code, exc.message) from exc
            if isinstance(exc, a.APIStatusError):
                raise self._fail(f"API error {exc.status_code}", exc.message) from exc
            if isinstance(exc, a.APIConnectionError):
                raise self._fail("network error", exc) from exc
            raise

        usage = getattr(response, "usage", None)
        self._record_usage(getattr(usage, "input_tokens", 0), getattr(usage, "output_tokens", 0), held)

        if response.stop_reason == "refusal":
            raise self._fail("model declined the request")
        if response.stop_reason == "max_tokens":
            raise self._fail("response was cut off (max_tokens)")
        return self._parse(next((b.text for b in response.content if b.type == "text"), None))


def untrusted_json(value: Any) -> str:
    """Serialise untrusted data for a prompt.

    JSON quoting keeps every string inside a value, and escaping ``<`` and
    ``>`` means text like ``</edits>`` in an edit summary cannot close the
    data block and "escape" into the instructions.
    """
    return (
        json.dumps(value, ensure_ascii=False, indent=1)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )
