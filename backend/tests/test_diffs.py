"""Fetching an edit's diff, and the moderator's evidence rule built on it."""
from __future__ import annotations

import json
import re
from typing import Optional

import httpx
import pytest

from app.ai.diffs import Diff, DiffFetcher, compare_request, is_wikimedia_host, normalise_quote, parse_compare_html
from app.ai.moderator import Moderator
from app.parser import parse_line

from .conftest import line
from .fakes import FakeLLM

# Shaped like MediaWiki's action=compare body: one row per changed line.
COMPARE_HTML = """
<tr><td colspan="2" class="diff-lineno">Line 12:</td><td colspan="2" class="diff-lineno">Line 12:</td></tr>
<tr>
  <td class="diff-marker" data-marker="−"></td>
  <td class="diff-deletedline diff-side-deleted"><div>Mars is the <del class="diffchange">fourth</del> planet from the Sun.</div></td>
  <td class="diff-marker" data-marker="+"></td>
  <td class="diff-addedline diff-side-added"><div>Mars is the <ins class="diffchange">STUPID</ins> planet&nbsp;&amp; nobody<br>cares LOL</div></td>
</tr>
<tr>
  <td class="diff-context diff-side-deleted"><div>Unchanged context line.</div></td>
  <td class="diff-context diff-side-added"><div>Unchanged context line.</div></td>
</tr>
<tr>
  <td class="diff-marker"></td><td class="diff-empty diff-side-deleted"></td>
  <td class="diff-marker" data-marker="+"></td>
  <td class="diff-addedline diff-side-added"><div>A whole new line with &lt;b&gt;markup&lt;/b&gt;.</div></td>
</tr>
"""


def edit(edit_id: str = "e", **overrides):
    return parse_line(line(meta={"id": edit_id}, **overrides))


# --------------------------------------------------------------- parsing
def test_compare_html_keeps_added_and_removed_lines_as_plain_text():
    diff = parse_compare_html(COMPARE_HTML)
    assert diff.removed == "Mars is the fourth planet from the Sun."
    assert diff.added.splitlines() == [
        "Mars is the STUPID planet & nobody cares LOL",  # &nbsp; and <br> become plain spaces
        "A whole new line with <b>markup</b>.",
    ]
    assert "Unchanged context" not in diff.added + diff.removed


def test_long_diffs_are_capped():
    body = '<tr><td class="diff-addedline"><div>' + "x" * 5000 + "</div></td></tr>"
    assert len(parse_compare_html(body).added) == 1500


def test_quotes_match_ignoring_case_spacing_and_curly_quotes():
    assert normalise_quote("  Nobody   CARES  ") in normalise_quote("Mars is the planet & nobody cares LOL")
    assert normalise_quote("it’s") == "it's"


# ------------------------------------------------------- what gets fetched
def test_compare_request_reads_the_revisions_from_the_diff_link():
    assert compare_request(edit()) == ("https://en.wikipedia.org/w/api.php", 10, 11)


@pytest.mark.parametrize(
    "overrides",
    [
        {"type": "new", "revision": {"new": 11}},  # a new page has no previous revision
        {"server_url": "https://evil.example.com"},  # not a Wikimedia host
        {"server_url": "https://en.wikipedia.org.evil.com"},  # look-alike host
        {"server_url": "http://en.wikipedia.org"},  # not HTTPS
    ],
)
def test_no_request_for_unusable_or_untrusted_links(overrides):
    assert compare_request(edit(**overrides)) is None


@pytest.mark.parametrize("host", ["en.wikipedia.org", "commons.wikimedia.org", "www.wikidata.org", "wikipedia.org"])
def test_wikimedia_hosts_are_allowed(host):
    assert is_wikimedia_host(host)


@pytest.mark.parametrize("host", ["wikipedia.org.evil.com", "notwikipedia.org", "localhost", "169.254.169.254"])
def test_other_hosts_are_refused(host):
    assert not is_wikimedia_host(host)


# ------------------------------------------------------------- fetching
def fetcher(handler) -> DiffFetcher:
    return DiffFetcher("WikiPulse-test", transport=httpx.MockTransport(handler))


async def test_fetch_asks_the_wikis_compare_api_and_parses_the_answer():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"compare": {"fromrevid": 10, "torevid": 11, "body": COMPARE_HTML}})

    diff = await fetcher(handler).fetch(edit())
    assert diff is not None and "STUPID" in diff.added
    (request,) = seen
    assert request.url.host == "en.wikipedia.org" and request.url.path == "/w/api.php"
    assert dict(request.url.params) == {
        "action": "compare", "fromrev": "10", "torev": "11", "prop": "diff", "format": "json", "formatversion": "2",
    }
    assert request.headers["User-Agent"] == "WikiPulse-test"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"error": {"code": "nosuchrevid"}}),
        httpx.Response(200, json={"compare": {"body": ""}}),  # nothing changed in the text
    ],
)
async def test_any_problem_means_no_diff(response):
    assert await fetcher(lambda request: response).fetch(edit()) is None


async def test_network_errors_mean_no_diff():
    def handler(request):
        raise httpx.ConnectTimeout("slow")

    assert await fetcher(handler).fetch(edit()) is None


async def test_untrusted_hosts_are_never_contacted():
    def handler(request):  # pragma: no cover - must not be called
        raise AssertionError("no request expected")

    assert await fetcher(handler).fetch(edit(server_url="https://evil.example.com")) is None


# ------------------------------------------------- the moderator's evidence rule
BLANKING = dict(length={"old": 8000, "new": 10}, comment="")
DIFF = Diff(added="Mars is the STUPID planet and nobody cares LOL", removed="Mars is the fourth planet from the Sun.")


class FakeDiffs:
    def __init__(self, diff: Optional[Diff] = DIFF, error: Optional[Exception] = None) -> None:
        self.diff, self.error, self.calls = diff, error, []

    async def fetch(self, edit):
        self.calls.append(edit.id)
        if self.error:
            raise self.error
        return self.diff


def answer(vandalism=True, confidence=0.9, reason="Inserted an insult", evidence=""):
    return lambda call: {
        "verdicts": [{"id": "e1", "vandalism": vandalism, "confidence": confidence, "reason": reason, "evidence": evidence}]
    }


def sent_edit(call):
    return json.loads(re.search(r"<edits>\n(.*)\n</edits>", call["user"], re.S).group(1))[0]


async def test_the_ai_sees_the_diff_and_its_quote_is_shown():
    llm = FakeLLM(answer(evidence="nobody  CARES lol"))
    mod = Moderator(llm, diffs=FakeDiffs())
    mod.observe(edit("a", **BLANKING))
    await mod.review_batch()

    sent = sent_edit(llm.calls[0])
    assert sent["added_text"] == DIFF.added and sent["removed_text"] == DIFF.removed
    flag = mod.flag_for("a")
    assert (flag.status, flag.source, flag.evidence) == ("flagged", "ai", "nobody  CARES lol")
    assert flag.to_dict()["evidence"] == "nobody  CARES lol"
    assert mod.counters["diffs_fetched"] == 1


async def test_a_quote_that_is_not_in_the_diff_is_not_trusted():
    llm = FakeLLM(answer(evidence="this text was never written"))
    mod = Moderator(llm, diffs=FakeDiffs())
    mod.observe(edit("a", **BLANKING))
    await mod.review_batch()

    flag = mod.flag_for("a")
    assert flag.source == "rules"  # the rules' decision stands
    assert flag.evidence is None
    assert "quote is not in the diff" in flag.note
    assert mod.counters["ai_evidence_rejected"] == 1


@pytest.mark.parametrize("evidence", ["", "  ", "lo", None])
async def test_a_vandalism_verdict_with_the_diff_needs_a_real_quote(evidence):
    mod = Moderator(FakeLLM(answer(evidence=evidence)), diffs=FakeDiffs())
    mod.observe(edit("a", **BLANKING))
    await mod.review_batch()
    assert mod.flag_for("a").source == "rules"


async def test_removed_text_counts_as_evidence_too():
    mod = Moderator(FakeLLM(answer(evidence="fourth planet from the Sun")), diffs=FakeDiffs())
    mod.observe(edit("a", **BLANKING))
    await mod.review_batch()
    assert mod.flag_for("a").status == "flagged"


async def test_clearing_an_edit_needs_no_quote():
    mod = Moderator(FakeLLM(answer(vandalism=False, reason="Routine copyedit")), diffs=FakeDiffs())
    mod.observe(edit("a", **BLANKING))
    await mod.review_batch()
    flag = mod.flag_for("a")
    assert (flag.status, flag.source, flag.evidence) == ("cleared", "ai", None)


async def test_without_a_diff_the_ai_judges_metadata_as_before():
    llm = FakeLLM(answer())
    mod = Moderator(llm, diffs=FakeDiffs(diff=None))
    mod.observe(edit("a", **BLANKING))
    await mod.review_batch()

    assert sent_edit(llm.calls[0])["diff"] == "unavailable"
    flag = mod.flag_for("a")
    assert (flag.status, flag.source, flag.evidence) == ("flagged", "ai", None)
    assert mod.counters["diffs_unavailable"] == 1


async def test_a_failing_diff_fetch_does_not_stop_the_review():
    mod = Moderator(FakeLLM(answer()), diffs=FakeDiffs(error=RuntimeError("boom")))
    mod.observe(edit("a", **BLANKING))
    assert await mod.review_batch() == 1
    assert mod.flag_for("a").source == "ai"


async def test_the_prompt_asks_for_an_exact_quote():
    llm = FakeLLM(answer(evidence="nobody cares"))
    mod = Moderator(llm, diffs=FakeDiffs())
    mod.observe(edit("a", **BLANKING))
    await mod.review_batch()
    call = llm.calls[0]
    assert "exact quote" in call["system"]
    assert "evidence" in call["schema"]["properties"]["verdicts"]["items"]["required"]
