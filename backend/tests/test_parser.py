from __future__ import annotations

import pytest

from app.parser import Deduper, InvalidEvent, parse_event, parse_line

from .conftest import SAMPLE_FILE, line, make_event


def reason(raw_line: str) -> str:
    with pytest.raises(InvalidEvent) as exc:
        parse_line(raw_line)
    return exc.value.reason


class TestValidEvents:
    def test_parses_a_normal_edit(self):
        edit = parse_line(line())
        assert edit.id == "evt-1"
        assert (edit.wiki, edit.title, edit.user) == ("enwiki", "Mars", "Alice")
        assert edit.delta == 100
        assert edit.diff_url == "https://en.wikipedia.org/w/index.php?diff=11&oldid=10"

    def test_page_creation_counts_as_edit(self):
        edit = parse_line(line(type="new", length={"new": 500}, revision={"new": 1}))
        assert edit.type == "new"
        assert edit.delta == 500
        assert edit.diff_url is None

    def test_underscores_and_spaces_are_the_same_page(self):
        a = parse_line(line(title="File:Solar_panel.png"))
        b = parse_line(line(title="File:Solar panel.png"))
        assert a.title == b.title == "File:Solar panel.png"

    def test_non_ascii_is_preserved(self):
        edit = parse_line(line(comment="Corrected café and naïve spellings"))
        assert edit.comment == "Corrected café and naïve spellings"


class TestRejectedEvents:
    def test_malformed_json(self):
        assert reason('{"meta":{"id":"x"},"type":"edit","title":"Broken"') == "malformed_json"

    def test_non_object(self):
        assert reason("[1, 2, 3]") == "not_an_object"

    @pytest.mark.parametrize("event_type", ["log", "categorize", None, "something-else"])
    def test_non_revision_types_are_ignored(self, event_type):
        assert reason(line(type=event_type)) == "ignored_type"

    @pytest.mark.parametrize("title", [None, "", "   ", 42])
    def test_missing_title(self, title):
        assert reason(line(title=title)) == "missing_title"

    def test_missing_wiki_without_any_host(self):
        raw = make_event(wiki=None, server_name=None)
        raw["meta"].pop("domain")
        with pytest.raises(InvalidEvent) as exc:
            parse_event(raw)
        assert exc.value.reason == "missing_wiki"


class TestRepairedFields:
    @pytest.mark.parametrize(
        "host, expected",
        [
            ("fr.wikipedia.org", "frwiki"),
            ("zh-min-nan.wikipedia.org", "zh_min_nanwiki"),
            ("commons.wikimedia.org", "commonswiki"),
            ("www.wikidata.org", "wikidatawiki"),
        ],
    )
    def test_missing_wiki_is_derived_from_host(self, host, expected):
        assert parse_line(line(wiki=None, server_name=host)).wiki == expected

    def test_millisecond_timestamp_is_converted(self):
        assert parse_line(line(timestamp=1794996719000)).timestamp == 1794996719.0

    def test_missing_timestamp_falls_back_to_meta_dt(self):
        assert parse_line(line(timestamp=None)).timestamp == 1794996000.0

    def test_missing_optional_fields_get_defaults(self):
        raw = make_event()
        for key in ("user", "comment", "bot", "minor", "length", "revision", "namespace"):
            raw.pop(key)
        edit = parse_event(raw)
        assert edit.user == "(unknown)"
        assert edit.comment == ""
        assert edit.bot is False
        assert edit.delta is None

    def test_missing_meta_id_uses_stable_fallback(self):
        raw = make_event()
        raw.pop("meta")
        assert parse_event(raw).id == "enwiki:rc:1001"
        assert parse_event(raw).id == parse_event(dict(raw)).id


class TestSafety:
    def test_html_in_comment_is_kept_as_plain_text(self):
        # The front end renders text, never HTML; the server must not "fix"
        # it by stripping tags (that would hide the evidence of an attack).
        payload = '<script>alert("xss")</script> Updated'
        assert parse_line(line(comment=payload)).comment == payload

    def test_javascript_url_is_never_used(self):
        edit = parse_line(line(title_url="javascript:alert(1)"))
        assert edit.url == "https://en.wikipedia.org/wiki/Mars"

    def test_control_characters_are_removed_and_comment_is_truncated(self):
        edit = parse_line(line(comment="a\x00b\nc" + "x" * 1000))
        assert "\x00" not in edit.comment and "\n" not in edit.comment
        assert len(edit.comment) == 500 and edit.comment.endswith("…")


class TestDeduper:
    def test_detects_repeats(self):
        d = Deduper()
        assert d.seen("a") is False
        assert d.seen("a") is True

    def test_memory_is_bounded(self):
        d = Deduper(max_size=2)
        for key in ("a", "b", "c"):
            d.seen(key)
        assert len(d) == 2
        assert d.seen("a") is False  # oldest was evicted


def test_whole_sample_file_is_handled_without_crashing():
    """Regression test pinned to the recorded sample and its known problems."""
    reasons = {}
    dedupe = Deduper()
    accepted = duplicates = 0
    for raw_line in SAMPLE_FILE.read_text(encoding="utf-8").splitlines():
        try:
            edit = parse_line(raw_line)
        except InvalidEvent as exc:
            reasons[exc.reason] = reasons.get(exc.reason, 0) + 1
            continue
        if dedupe.seen(edit.id):
            duplicates += 1
        else:
            accepted += 1

    assert reasons.get("malformed_json") == 1
    assert reasons.get("ignored_type") == 160 + 77  # log + categorize
    assert reasons.get("missing_title", 0) >= 1
    assert duplicates > 0
    assert accepted > 1500
    # Every accepted line is valid JSON with a timestamp in seconds.
    for raw_line in SAMPLE_FILE.read_text(encoding="utf-8").splitlines():
        try:
            edit = parse_line(raw_line)
        except InvalidEvent:
            continue
        assert edit.timestamp is None or edit.timestamp < 10**11


class TestHostileValues:
    @pytest.mark.parametrize("raw_ts", ["1e999", "-1e999", "NaN", "Infinity"])
    def test_non_finite_timestamps_are_dropped_not_sent_as_invalid_json(self, raw_ts):
        import json as _json

        text = line(timestamp=0).replace('"timestamp": 0', f'"timestamp": {raw_ts}')
        edit = parse_line(text)
        assert edit.timestamp == 1794996000.0  # falls back to meta.dt
        _json.dumps(edit.to_dict(), allow_nan=False)  # would raise on inf/NaN

    @pytest.mark.parametrize("wiki", ["EN wiki", "en-wiki", "<script>", "x" * 65])
    def test_malformed_wiki_id_is_derived_from_the_host_instead(self, wiki):
        assert parse_line(line(wiki=wiki)).wiki == "enwiki"
