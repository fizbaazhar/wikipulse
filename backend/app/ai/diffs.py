"""Fetch what an edit actually changed, so the AI judges content, not just metadata.

The stream only says *that* a page changed (size, summary). For a suspicious
edit we ask the wiki's own API for the diff (``action=compare``) and keep the
lines that were added and removed, as plain text.

Safety:

- Requests only go to Wikimedia hosts over HTTPS. The host comes from the
  edit's ``diff_url``, which is stream data, so anything else is refused
  (no requests to arbitrary servers).
- Short timeout, size caps on the response and on the text kept, and a
  failure just means "no diff": the moderator then reviews metadata only.
"""
from __future__ import annotations

import html
import logging
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

import httpx

from ..parser import Edit

log = logging.getLogger(__name__)

# Wikimedia projects. A host must be one of these or a subdomain of one.
WIKIMEDIA_DOMAINS = (
    "wikipedia.org",
    "wikimedia.org",
    "wikidata.org",
    "wiktionary.org",
    "wikibooks.org",
    "wikinews.org",
    "wikiquote.org",
    "wikisource.org",
    "wikiversity.org",
    "wikivoyage.org",
    "mediawiki.org",
    "wikifunctions.org",
)
MAX_SIDE_CHARS = 1_500  # text kept per side (added / removed) for the prompt
MAX_RESPONSE_BYTES = 500_000
# Tags with no closing tag: they must not count towards nesting depth.
_VOID_TAGS = frozenset({"br", "img", "hr", "wbr", "input", "meta", "link", "source"})
_BREAKS = frozenset({"br", "div", "p", "li"})


@dataclass(frozen=True)
class Diff:
    added: str
    removed: str

    @property
    def empty(self) -> bool:
        return not (self.added or self.removed)


def is_wikimedia_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in WIKIMEDIA_DOMAINS)


def compare_request(edit: Edit) -> Optional[Tuple[str, int, int]]:
    """``(api_url, old_rev, new_rev)`` for an edit, or None if it has no usable diff link."""
    if not edit.diff_url:
        return None
    parts = urlsplit(edit.diff_url)
    if parts.scheme != "https" or not parts.hostname or not is_wikimedia_host(parts.hostname):
        return None
    query = parse_qs(parts.query)
    try:
        new_rev, old_rev = int(query["diff"][0]), int(query["oldid"][0])
    except (KeyError, ValueError, IndexError):
        return None
    if old_rev <= 0 or new_rev <= 0:
        return None
    return f"https://{parts.hostname}/w/api.php", old_rev, new_rev


class _DiffTable(HTMLParser):
    """Collects the text of added and deleted lines from MediaWiki's diff table."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.added: List[str] = []
        self.removed: List[str] = []
        self._side: Optional[List[str]] = None
        self._depth = 0  # nesting inside the current cell
        self._buf: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if self._side is not None:
            if tag in _BREAKS:
                self._buf.append(" ")  # "a<br>b" is two words, not "ab"
            if tag not in _VOID_TAGS:
                self._depth += 1
            return
        if tag != "td":
            return
        classes = (dict(attrs).get("class") or "").split()
        if "diff-addedline" in classes:
            self._side, self._depth, self._buf = self.added, 0, []
        elif "diff-deletedline" in classes:
            self._side, self._depth, self._buf = self.removed, 0, []

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if self._side is not None and tag in _BREAKS:
            self._buf.append(" ")  # <br/>: a word break, but no nesting

    def handle_endtag(self, tag: str) -> None:
        if self._side is None or tag in _VOID_TAGS:
            return
        if self._depth > 0:
            self._depth -= 1
            return
        text = " ".join("".join(self._buf).split())
        if text:
            self._side.append(text)
        self._side = None

    def handle_data(self, data: str) -> None:
        if self._side is not None:
            self._buf.append(data)


def parse_compare_html(body: str) -> Diff:
    """Added and removed text from the HTML of ``action=compare`` (``compare.body``)."""
    table = _DiffTable()
    table.feed(body)
    table.close()
    return Diff(added=_cap("\n".join(table.added)), removed=_cap("\n".join(table.removed)))


def _cap(text: str) -> str:
    text = html.unescape(text)
    return text if len(text) <= MAX_SIDE_CHARS else text[: MAX_SIDE_CHARS - 1] + "…"


def normalise_quote(text: str) -> str:
    """For matching a quote against the diff: case, whitespace and quote marks ignored."""
    text = text.lower().replace("’", "'").replace("“", '"').replace("”", '"')
    return " ".join(re.sub(r"\s+", " ", text).split())


class DiffFetcher:
    """Fetches diffs from Wikimedia's API. One shared HTTP client, short timeouts."""

    def __init__(self, user_agent: str, timeout: float = 6.0, transport: Optional[httpx.AsyncBaseTransport] = None):
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            follow_redirects=False,
            transport=transport,
        )

    async def fetch(self, edit: Edit) -> Optional[Diff]:
        request = compare_request(edit)
        if request is None:
            return None
        api, old_rev, new_rev = request
        params = {
            "action": "compare",
            "fromrev": old_rev,
            "torev": new_rev,
            "prop": "diff",
            "format": "json",
            "formatversion": "2",
        }
        try:
            response = await self._client.get(api, params=params)
            if response.status_code != 200 or len(response.content) > MAX_RESPONSE_BYTES:
                return None
            body = response.json().get("compare", {}).get("body")
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            log.info("diff for %s unavailable: %s", edit.id, type(exc).__name__)
            return None
        if not isinstance(body, str):
            return None
        diff = parse_compare_html(body)
        return None if diff.empty else diff

    async def aclose(self) -> None:
        await self._client.aclose()
