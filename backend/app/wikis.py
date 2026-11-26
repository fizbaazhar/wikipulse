"""Wiki ids (``enwiki``, ``commonswiki``...) and their display names."""
from __future__ import annotations

import re
from typing import Any, Optional

# One rule everywhere a wiki id comes in: the event parser, the REST filters
# and the WebSocket ``subscribe`` message. So every wiki shown can be selected.
WIKI_ID_PATTERN = r"^[a-z0-9_]{1,64}$"
WIKI_ID = re.compile(WIKI_ID_PATTERN)

WIKI_NAMES = {
    "enwiki": "English", "dewiki": "German", "frwiki": "French", "eswiki": "Spanish",
    "itwiki": "Italian", "jawiki": "Japanese", "ruwiki": "Russian", "ptwiki": "Portuguese",
    "zhwiki": "Chinese", "arwiki": "Arabic", "urwiki": "Urdu", "hiwiki": "Hindi",
    "plwiki": "Polish", "nlwiki": "Dutch", "commonswiki": "Commons", "wikidatawiki": "Wikidata",
}


def wiki_label(wiki: str) -> str:
    return WIKI_NAMES.get(wiki, wiki)


def validate_wiki(value: Any) -> Optional[str]:
    """Accept a wiki id like ``enwiki`` or None; reject anything else."""
    if value is None or value == "":
        return None
    if isinstance(value, str) and WIKI_ID.match(value):
        return value
    raise ValueError("invalid wiki id")
