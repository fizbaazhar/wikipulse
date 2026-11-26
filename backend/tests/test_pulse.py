from __future__ import annotations

from app.ai.llm import RateLimiter
from app.parser import parse_line
from app.ai.pulse import PulseService, rule_summary
from app.stats import RollingStats

from .conftest import line
from .fakes import FakeLLM, failing


def stats_with(clock, pages):
    stats = RollingStats(clock=clock)
    for title, n in pages:
        for _ in range(n):
            stats.add(parse_line(line(title=title)))
    return stats


def test_rule_summary_reads_naturally():
    snap = {
        "top_pages": [
            {"title": "Mars", "wiki": "enwiki", "count": 9},
            {"title": "London", "wiki": "enwiki", "count": 4},
            {"title": "Paris", "wiki": "frwiki", "count": 2},
        ],
        "wikis": [{"wiki": "enwiki", "count": 13}, {"wiki": "frwiki", "count": 2}],
        "edits_last_minute": 15,
        "bot_share": 0.2,
    }
    result = rule_summary(snap, flagged=1)
    # Titles are wrapped in bidi isolates so right-to-left titles render correctly.
    assert "⁨Mars⁩" in result["summary"]
    plain = {k: v.replace("⁨", "").replace("⁩", "") for k, v in result.items()}
    assert plain["headline"] == "“Mars” leads Wikipedia activity"
    assert "Mars with 9 edits on English, followed by London (4), Paris (2)." in plain["summary"]
    assert "15 edits in the last minute across 2 wikis; 20% by bots." in plain["summary"]
    assert "1 edit flagged" in plain["summary"]


async def test_without_llm_uses_rule_summary(clock):
    pulse = PulseService(stats_with(clock, [("Mars", 3)]), llm=None, clock=clock)
    result = await pulse.refresh()
    assert result["source"] == "rules"
    assert "Mars" in result["headline"]


async def test_llm_summary_is_used_and_cached_while_trending_is_unchanged(clock):
    llm = FakeLLM(lambda call: {"headline": "Mars edits surge", "summary": "Mars is busy."})
    stats = stats_with(clock, [("Mars", 3), ("London", 2)])
    pulse = PulseService(stats, llm=llm, clock=clock)

    first = await pulse.refresh()
    assert (first["source"], first["headline"]) == ("ai", "Mars edits surge")
    assert "Mars" in llm.calls[0]["user"] and "<stats>" in llm.calls[0]["user"]

    clock.advance(60)
    await pulse.refresh()
    assert len(llm.calls) == 1  # same top pages → no new (paid) call

    stats.add(parse_line(line(title="Venus")))
    for _ in range(5):
        stats.add(parse_line(line(title="Venus")))
    await pulse.refresh()
    assert len(llm.calls) == 2  # trending changed → new summary


async def test_llm_failure_keeps_card_useful(clock):
    pulse = PulseService(stats_with(clock, [("Mars", 3)]), llm=FakeLLM(failing("timeout")), clock=clock)
    result = await pulse.refresh()
    assert result["source"] == "rules"
    assert result["note"] == "AI summary unavailable: timeout"


async def test_llm_output_is_cleaned(clock):
    llm = FakeLLM(lambda call: {"headline": "A\nB", "summary": "x" * 2000})
    result = await PulseService(stats_with(clock, [("Mars", 1)]), llm=llm, clock=clock).refresh()
    assert result["headline"] == "A B"
    assert len(result["summary"]) <= 600


async def test_budget_exhausted_falls_back(clock):
    llm = FakeLLM(lambda call: {"headline": "h", "summary": "s"})
    pulse = PulseService(stats_with(clock, [("Mars", 1)]), llm=llm, limiter=RateLimiter(0), clock=clock)
    result = await pulse.refresh()
    assert llm.calls == []
    assert result["note"] == "AI summary paused: hourly limit reached"


async def test_manual_refresh_has_cooldown(clock):
    llm = FakeLLM(lambda call: {"headline": "h", "summary": "s"})
    pulse = PulseService(stats_with(clock, [("Mars", 1)]), llm=llm, clock=clock, min_manual_interval=30)
    assert (await pulse.manual_refresh())[0] is True
    assert (await pulse.manual_refresh())[0] is False
    clock.advance(31)
    assert (await pulse.manual_refresh())[0] is True
    assert len(llm.calls) == 2


async def test_take_update_reports_changes_once(clock):
    pulse = PulseService(stats_with(clock, [("Mars", 1)]), clock=clock)
    await pulse.refresh()
    assert pulse.take_update() is not None
    assert pulse.take_update() is None


async def test_unexpected_sdk_error_keeps_rule_summary(clock):
    pulse = PulseService(stats_with(clock, [("Mars", 1)]), llm=FakeLLM(lambda call: KeyError("x")), clock=clock)
    result = await pulse.refresh()
    assert (result["source"], result["note"]) == ("rules", "AI summary unavailable: unexpected error")
