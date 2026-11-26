"""Turn raw recentchange events into clean ``Edit`` objects.

The stream (and the recorded sample) is not perfectly clean, so this module is
deliberately defensive. Every rejection carries a ``reason`` so the pipeline can
count *why* events were dropped instead of silently losing them.

Handled cases:
* malformed / truncated JSON lines
* non-object payloads
* event types that are not page revisions (``log``, ``categorize``)
* missing ``title`` (cannot be ranked) or missing ``wiki`` (derived from the
  server name when possible)
* timestamps in milliseconds instead of seconds, or missing timestamps
* missing ``meta.id`` (a stable fallback key is built for de-duplication)
* control characters and very long comments
* non-http(s) URLs (e.g. ``javascript:``) are never passed to the browser
"""
from __future__ import annotations

import ipaddress
import json
import math
import re
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import quote

from .wikis import WIKI_ID

# ``edit`` = change to an existing page, ``new`` = page creation. Both are page
# revisions. ``log`` (deletions, blocks, protections...) and ``categorize`` are
# not edits a reader would count, so they are excluded from all statistics.
COUNTED_TYPES = frozenset({"edit", "new"})

MAX_COMMENT_LEN = 500
MAX_TITLE_LEN = 300
MAX_USER_LEN = 100

# Epoch seconds will not reach 1e11 until the year 5138, so anything larger is
# certainly milliseconds.
_MS_THRESHOLD = 10**11

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_TEMP_ACCOUNT = re.compile(r"^~\d{4}-\d+-\d+$")
_WIKIPEDIA_HOST = re.compile(r"^([a-z0-9-]+)\.wikipedia\.org$")
_SPECIAL_HOSTS = {
    "commons.wikimedia.org": "commonswiki",
    "www.wikidata.org": "wikidatawiki",
    "meta.wikimedia.org": "metawiki",
    "species.wikimedia.org": "specieswiki",
}


class InvalidEvent(ValueError):
    """Raised when an event cannot or should not be turned into an ``Edit``."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Edit:
    id: str
    wiki: str
    title: str
    url: str
    user: str
    bot: bool
    type: str
    namespace: int
    comment: str
    timestamp: Optional[float]
    minor: bool
    length_old: Optional[int]
    length_new: Optional[int]
    diff_url: Optional[str]

    @property
    def delta(self) -> Optional[int]:
        """Change in page size in bytes (negative = content removed)."""
        if self.length_new is None:
            return None
        return self.length_new - (self.length_old or 0)

    @property
    def anonymous(self) -> bool:
        """Logged-out editor: an IP address, or a temporary account.

        Wikipedia now gives logged-out editors temporary accounts named like
        ``~2026-61790-62`` instead of showing their IP (found on the live
        stream: no IP editors at all, but many ``~`` names).
        """
        return is_ip(self.user) or bool(_TEMP_ACCOUNT.match(self.user))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "wiki": self.wiki,
            "title": self.title,
            "url": self.url,
            "user": self.user,
            "bot": self.bot,
            "type": self.type,
            "namespace": self.namespace,
            "comment": self.comment,
            "timestamp": self.timestamp,
            "minor": self.minor,
            "length_old": self.length_old,
            "length_new": self.length_new,
            "delta": self.delta,
            "diff_url": self.diff_url,
        }


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def clean_text(value: Any, max_len: int) -> str:
    """Return a single-line, length-limited string (``""`` for non-strings).

    HTML is *not* escaped here: the browser renders all text as text, so
    escaping on the server would only double-escape it.
    """
    if not isinstance(value, str):
        return ""
    text = _CONTROL_CHARS.sub(" ", value).strip()
    if len(text) > max_len:
        text = text[: max_len - 1].rstrip() + "…"
    return text


def normalize_timestamp(value: Any, meta_dt: Any = None) -> Optional[float]:
    """Return epoch seconds, accepting seconds or milliseconds, else ``meta.dt``."""
    # `json.loads` turns 1e999 into inf; inf/NaN would produce invalid JSON for
    # the browser (`Infinity`), so only finite values are accepted.
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
        return value / 1000.0 if value >= _MS_THRESHOLD else float(value)
    if isinstance(meta_dt, str) and meta_dt:
        try:
            return datetime.fromisoformat(meta_dt.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def derive_wiki(host: Any) -> Optional[str]:
    """Map ``en.wikipedia.org`` -> ``enwiki`` etc. when the ``wiki`` field is missing."""
    if not isinstance(host, str):
        return None
    host = host.lower()
    if host in _SPECIAL_HOSTS:
        return _SPECIAL_HOSTS[host]
    match = _WIKIPEDIA_HOST.match(host)
    if match:
        wiki = match.group(1).replace("-", "_") + "wiki"
        return wiki if WIKI_ID.match(wiki) else None
    return None


def is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def _is_http_url(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(("https://", "http://"))


def _as_int(value: Any) -> Optional[int]:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def parse_line(line: str) -> Edit:
    """Parse one JSON line (from the sample file or an SSE ``data:`` field)."""
    try:
        raw = json.loads(line)
    except (json.JSONDecodeError, TypeError):
        raise InvalidEvent("malformed_json") from None
    return parse_event(raw)


def parse_event(raw: Any) -> Edit:
    if not isinstance(raw, dict):
        raise InvalidEvent("not_an_object")

    event_type = raw.get("type")
    if event_type not in COUNTED_TYPES:
        raise InvalidEvent("ignored_type")

    meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}

    # Titles arrive both as "File:Solar panel.png" and "File:Solar_panel.png";
    # normalise underscores so the same page is counted once.
    title = clean_text(raw.get("title"), MAX_TITLE_LEN).replace("_", " ")
    if not title:
        raise InvalidEvent("missing_title")

    wiki = raw.get("wiki") if isinstance(raw.get("wiki"), str) and WIKI_ID.match(raw["wiki"]) else None
    wiki = wiki or derive_wiki(raw.get("server_name")) or derive_wiki(meta.get("domain"))
    if not wiki:
        raise InvalidEvent("missing_wiki")

    server_url = raw.get("server_url") if _is_http_url(raw.get("server_url")) else None
    if server_url is None and isinstance(raw.get("server_name"), str):
        server_url = "https://" + raw["server_name"]

    if _is_http_url(raw.get("title_url")):
        url = raw["title_url"]
    elif server_url:
        url = f"{server_url}/wiki/{quote(title.replace(' ', '_'))}"
    else:
        url = ""

    timestamp = normalize_timestamp(raw.get("timestamp"), meta.get("dt"))
    user = clean_text(raw.get("user"), MAX_USER_LEN) or "(unknown)"

    length = raw.get("length") if isinstance(raw.get("length"), dict) else {}
    revision = raw.get("revision") if isinstance(raw.get("revision"), dict) else {}
    rev_old, rev_new = _as_int(revision.get("old")), _as_int(revision.get("new"))
    diff_url = (
        f"{server_url}/w/index.php?diff={rev_new}&oldid={rev_old}"
        if server_url and rev_old and rev_new
        else None
    )

    event_id = meta.get("id") if isinstance(meta.get("id"), str) and meta.get("id") else None
    if event_id is None:
        rc_id = _as_int(raw.get("id"))
        event_id = f"{wiki}:rc:{rc_id}" if rc_id is not None else f"{wiki}:{title}:{timestamp}:{user}"

    namespace = _as_int(raw.get("namespace"))

    return Edit(
        id=event_id,
        wiki=wiki,
        title=title,
        url=url,
        user=user,
        bot=raw.get("bot") is True,
        type=event_type,
        namespace=namespace if namespace is not None else 0,
        comment=clean_text(raw.get("comment"), MAX_COMMENT_LEN),
        timestamp=timestamp,
        minor=raw.get("minor") is True,
        length_old=_as_int(length.get("old")),
        length_new=_as_int(length.get("new")),
        diff_url=diff_url,
    )


class Deduper:
    """Remembers the most recent ``max_size`` event ids (bounded memory).

    The stream can redeliver events (e.g. after a reconnect with Last-Event-ID)
    and the sample contains duplicates, so every event passes through this.
    """

    def __init__(self, max_size: int = 50_000) -> None:
        self.max_size = max_size
        self._seen: "OrderedDict[str, None]" = OrderedDict()

    def seen(self, key: str) -> bool:
        """Return True if ``key`` was already seen; otherwise record it."""
        if key in self._seen:
            self._seen.move_to_end(key)
            return True
        self._seen[key] = None
        if len(self._seen) > self.max_size:
            self._seen.popitem(last=False)
        return False

    def __len__(self) -> int:
        return len(self._seen)
