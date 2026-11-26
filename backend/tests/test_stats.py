from __future__ import annotations

from app.parser import parse_line
from app.stats import RollingStats

from .conftest import line


def add(stats: RollingStats, title: str, wiki: str = "enwiki", bot: bool = False, n: int = 1) -> None:
    for _ in range(n):
        stats.add(parse_line(line(title=title, wiki=wiki, bot=bot)))


def test_top_pages_are_ranked_by_count_with_stable_ties(clock):
    stats = RollingStats(clock=clock)
    add(stats, "B", n=3)
    add(stats, "A", n=3)
    add(stats, "C", n=5)
    add(stats, "D", n=1)
    top = stats.snapshot(top_n=3)["top_pages"]
    assert [(p["title"], p["count"]) for p in top] == [("C", 5), ("A", 3), ("B", 3)]


def test_top_pages_are_limited_to_ten(clock):
    stats = RollingStats(clock=clock)
    for i in range(15):
        add(stats, f"Page {i}")
    assert len(stats.snapshot()["top_pages"]) == 10


def test_edits_leave_the_window_after_five_minutes(clock):
    stats = RollingStats(window_seconds=300, clock=clock)
    add(stats, "Old", n=4)
    clock.advance(200)
    add(stats, "New", n=2)

    snap = stats.snapshot()
    assert snap["edits_in_window"] == 6

    clock.advance(101)  # "Old" edits are now 301 s old
    snap = stats.snapshot()
    assert snap["edits_in_window"] == 2
    assert [p["title"] for p in snap["top_pages"]] == ["New"]


def test_edits_last_minute_is_rolling(clock):
    stats = RollingStats(clock=clock)
    add(stats, "A", n=3)
    clock.advance(30)
    add(stats, "A", n=2)
    assert stats.snapshot()["edits_last_minute"] == 5
    clock.advance(31)
    assert stats.snapshot()["edits_last_minute"] == 2


def test_wiki_filter_applies_to_every_metric(clock):
    stats = RollingStats(clock=clock)
    add(stats, "Paris", wiki="frwiki", n=2, bot=True)
    add(stats, "London", wiki="enwiki", n=5)

    fr = stats.snapshot("frwiki")
    assert fr["edits_last_minute"] == 2
    assert fr["edits_in_window"] == 2
    assert fr["bot_share"] == 1.0
    assert [p["title"] for p in fr["top_pages"]] == ["Paris"]
    assert fr["edits_per_minute"][-1]["count"] == 2

    everything = stats.snapshot()
    assert everything["edits_in_window"] == 7
    assert everything["wikis"] == [{"wiki": "enwiki", "count": 5}, {"wiki": "frwiki", "count": 2}]


def test_same_title_on_different_wikis_is_a_different_page(clock):
    stats = RollingStats(clock=clock)
    add(stats, "Mars", wiki="enwiki", n=2)
    add(stats, "Mars", wiki="dewiki", n=1)
    top = stats.snapshot()["top_pages"]
    assert [(p["wiki"], p["count"]) for p in top] == [("enwiki", 2), ("dewiki", 1)]


def test_per_minute_series_is_fixed_length_and_aligned(clock):
    clock.now = 1_800_000_000 - (1_800_000_000 % 60)  # start of a minute
    stats = RollingStats(history_minutes=5, clock=clock)
    add(stats, "A", n=2)
    clock.advance(60)
    add(stats, "A", n=3)

    series = stats.snapshot()["edits_per_minute"]
    assert len(series) == 5
    assert [s["count"] for s in series] == [0, 0, 0, 2, 3]
    assert all(s["minute"] % 60 == 0 for s in series)


def test_memory_is_released_when_window_empties(clock):
    stats = RollingStats(window_seconds=10, history_minutes=2, clock=clock)
    for i in range(100):
        add(stats, f"P{i}")
    clock.advance(600)
    snap = stats.snapshot()
    assert snap["edits_in_window"] == 0
    assert snap["top_pages"] == [] and snap["wikis"] == []
    assert stats._urls == {}
    assert len(stats._minutes) == 0


# --------------------------------------------------------------------------- #
# Chart series
# --------------------------------------------------------------------------- #
def add_edit(stats, **overrides):
    stats.add(parse_line(line(**overrides)))


def test_per_second_splits_humans_and_bots_and_skips_current_second(clock):
    clock.now = 1_800_000_000.0
    stats = RollingStats(clock=clock)
    add_edit(stats, bot=False)
    add_edit(stats, bot=True)
    clock.advance(1)
    add_edit(stats, bot=False)  # still-filling second: not reported yet

    series = stats.snapshot()["per_second"]
    assert len(series) == 120
    assert series[-1] == {"t": 1_800_000_000, "human": 1, "bot": 1}
    assert sum(p["human"] + p["bot"] for p in series) == 2


def test_wiki_minutes_folds_small_wikis_into_other(clock):
    stats = RollingStats(clock=clock)
    for i, wiki in enumerate(["enwiki", "dewiki", "frwiki", "eswiki", "itwiki", "jawiki", "plwiki"]):
        for _ in range(10 - i):
            add_edit(stats, wiki=wiki)
    data = stats.snapshot()["wiki_minutes"]
    assert data["keys"] == ["enwiki", "dewiki", "frwiki", "eswiki", "itwiki", "other"]
    assert data["points"][-1]["counts"]["other"] == 5 + 4  # jawiki + plwiki
    assert sum(data["points"][-1]["counts"].values()) == stats.snapshot()["edits_in_window"]

    only_fr = stats.snapshot("frwiki")["wiki_minutes"]
    assert only_fr["keys"] == ["frwiki"]


def test_editor_mix(clock):
    stats = RollingStats(clock=clock)
    add_edit(stats, user="Alice")
    add_edit(stats, user="Bot1", bot=True)
    add_edit(stats, user="203.0.113.9")
    add_edit(stats, user="2001:db8::1")
    add_edit(stats, user="~2026-61790-62")  # temporary account
    assert stats.snapshot()["editors"] == {"registered": 1, "bot": 1, "anonymous": 3}


def test_size_histogram_bins_and_signs(clock):
    stats = RollingStats(clock=clock)
    for old, new in [(20000, 100), (1000, 1000), (100, 150), (100, 105), (10, 50_000)]:
        add_edit(stats, length={"old": old, "new": new})
    add_edit(stats, length={})  # unknown size is not counted
    bins = {b["label"]: (b["count"], b["sign"]) for b in stats.snapshot()["size_histogram"]}
    assert bins["−10K+"] == (1, -1)
    assert bins["0"] == (1, 0)
    assert bins["+10"] == (1, 1)
    assert bins["+1"] == (1, 1)
    assert bins["+10K+"] == (1, 1)
    assert sum(c for c, _ in bins.values()) == 5


def test_top_pages_have_trend_sparklines(clock):
    stats = RollingStats(window_seconds=300, clock=clock)
    add_edit(stats, title="Mars")
    clock.advance(290)
    add_edit(stats, title="Mars")
    add_edit(stats, title="Mars")
    trend = stats.snapshot()["top_pages"][0]["trend"]
    assert len(trend) == 10
    assert trend[0] == 1 and trend[-1] == 2
