from __future__ import annotations

import json

import httpx
import openai
import pytest

from app.ai.budget import BudgetExceeded, DailyBudget
from app.ai.llm import AzureOpenAILLM, LLMError

from .fakes import SCHEMA, completion

DAY1 = 1_800_000_000.0  # 2027-01-15 08:00 UTC
DAY2 = DAY1 + 24 * 3600


def budget(limit=1.0, path=None, clock=lambda: DAY1):
    # $1 per 1M input tokens, $4 per 1M output tokens: easy arithmetic
    return DailyBudget(limit, 1.0, 4.0, path=path, clock=clock)


def test_cost_uses_input_and_output_prices():
    assert budget().cost(1_000_000, 250_000) == pytest.approx(2.0)


def test_records_spend_and_reports_remaining():
    b = budget()
    b.record(100_000, 50_000)  # $0.10 + $0.20
    s = b.status()
    assert s["spent_usd"] == pytest.approx(0.30)
    assert s["remaining_usd"] == pytest.approx(0.70)
    assert s["calls"] == 1


def test_blocks_a_call_whose_worst_case_would_cross_the_limit():
    b = budget(limit=0.05)
    b.record(0, 10_000)  # $0.04 spent
    # 4,000 output tokens could cost $0.016 -> 0.056 > 0.05: blocked before sending
    with pytest.raises(BudgetExceeded, match=r"daily AI budget of \$0.05 reached"):
        b.reserve(prompt_chars=300, max_output_tokens=4_000)
    b.reserve(prompt_chars=300, max_output_tokens=1_000)  # $0.004 still fits
    assert b.status()["blocked_calls"] == 1


def test_calls_running_at_once_cannot_cross_the_limit_together():
    b = budget(limit=0.01)
    first = b.reserve(0, 2_000)  # $0.008 held while the call runs
    with pytest.raises(BudgetExceeded):
        b.reserve(0, 2_000)  # would only fit if the first call were ignored
    b.record(0, 500, held=first)  # it really cost $0.002
    b.reserve(0, 1_000)  # $0.002 + $0.004 now fits
    held = b.reserve(0, 500)
    b.release(held)  # a failed call gives its hold back
    assert b.reserved_usd == pytest.approx(0.004, abs=1e-5)


def test_resets_at_midnight_utc():
    now = [DAY1]
    b = budget(clock=lambda: now[0])
    b.record(0, 250_000)  # $1.00, limit reached
    with pytest.raises(BudgetExceeded):
        b.reserve(0, 1)
    now[0] = DAY2
    b.reserve(0, 1)
    assert b.status()["spent_usd"] == 0


def test_spend_survives_a_restart_on_the_same_day(tmp_path):
    path = tmp_path / ".state" / "spend.json"
    budget(path=path).record(0, 100_000)  # $0.40
    assert budget(path=path).status()["spent_usd"] == pytest.approx(0.40)
    # ...but not into the next day
    assert budget(path=path, clock=lambda: DAY2).status()["spent_usd"] == 0
    assert json.loads(path.read_text())["day"] == "2027-01-15"


def test_corrupt_spend_file_is_ignored(tmp_path):
    path = tmp_path / "spend.json"
    path.write_text("{not json")
    assert budget(path=path).status()["spent_usd"] == 0


async def test_llm_stops_before_sending_when_budget_is_used_up():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=completion())

    client = openai.AsyncAzureOpenAI(
        api_key="k", azure_endpoint="https://example.openai.azure.com/", api_version="2024-10-21",
        max_retries=0, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    llm = AzureOpenAILLM(api_key="k", endpoint="https://example.openai.azure.com/", deployment="d", client=client)
    llm.budget = DailyBudget(0.01, 1.0, 4.0)

    await llm.complete_json(system="s", user="u", schema=SCHEMA, max_tokens=500)  # fits
    assert llm.budget.status()["spent_usd"] > 0  # usage from the response was recorded
    llm.budget.record(0, 2_500)  # push spend to the limit
    with pytest.raises(LLMError, match="daily AI budget"):
        await llm.complete_json(system="s", user="u", schema=SCHEMA, max_tokens=500)
    assert len(requests) == 1  # the blocked call never reached Azure
    assert "daily AI budget" in llm.status()["last_error"]
