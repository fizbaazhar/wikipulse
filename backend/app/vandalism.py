"""Rule-based vandalism signals: the cheap, always-on first layer.

Every edit is scored here (microseconds, no network). Only edits that look
suspicious are sent to the LLM for a second opinion, which keeps the API bill
proportional to the number of *suspicious* edits, not to stream volume.

Limitations: the recentchange stream does not contain the diff text, only the
edit summary (comment), byte sizes and the user, so these rules look at
metadata. Fetching the diff for suspicious edits is listed as future work.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Tuple

from .parser import Edit

# Score at which an edit is shown as suspicious and sent to the AI reviewer.
SUSPECT_THRESHOLD = 0.25
# Score at which the rules alone are confident enough to flag the edit.
FLAG_THRESHOLD = 0.5

USER_NAMESPACE = 2  # "User:" pages, e.g. personal sandboxes
USER_TALK_NAMESPACE = 3
# Percentage-based removal rules only apply once this many bytes are gone.
MIN_RATIO_REMOVAL = 1_000


@dataclass(frozen=True)
class Signal:
    code: str
    weight: float
    reason: str


@dataclass(frozen=True)
class Assessment:
    score: float
    signals: Tuple[Signal, ...] = field(default_factory=tuple)

    @property
    def suspicious(self) -> bool:
        return self.score >= SUSPECT_THRESHOLD

    @property
    def codes(self) -> List[str]:
        return [s.code for s in self.signals]

    @property
    def reason(self) -> str:
        return "; ".join(s.reason for s in self.signals)


_PROFANITY = re.compile(
    r"\b(fuck\w*|shit\w*|bitch\w*|asshole|idiot\w*|stupid|dumb|sucks?|poop\w*|penis|gay\b|lol+|haha\w*)",
    re.IGNORECASE,
)
_INJECTION = re.compile(
    r"(ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?)"
    r"|system (override|prompt|instructions)"
    r"|reveal (your )?(system|hidden|api)"
    r"|api[ _-]?keys?"
    r"|you are now|act as (an?|the) "
    r"|(mark|label|classify) (this|every|all)( edits?)? as (safe|ok|not vandalism)"
    r"|\{\s*\"label\"\s*:)",
    re.IGNORECASE,
)
_MARKUP = re.compile(r"(<\s*script|<\s*iframe|javascript:|\bon(error|load|click)\s*=|<\s*img\b)", re.IGNORECASE)
_REPEATED = re.compile(r"(.)\1{5,}")
_AUTO_SECTION = re.compile(r"/\*.*?\*/")
# Turning a page into a redirect after a merge legitimately removes almost
# everything. Found on the live stream: itwiki "unione su [[...]]" (merged into).
_REDIRECT_OR_MERGE = re.compile(
    r"(#redirect|redirect|merge[ds]?\b|merging|wbmergeitems|wbcreateredirect|unione|unito|rinvio|redirection|fusion"
    r"|weiterleitung|zusammengef|redirecci|fusi[oó]n|przekierowanie|перенаправ|объедин)",
    re.IGNORECASE,
)


def _shouting(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 10 and sum(c.isupper() for c in letters) / len(letters) > 0.7


def _page_owner(title: str) -> str:
    """'User talk:GingaCat/Archive 1' -> 'GingaCat' (any language prefix)."""
    return title.split(":", 1)[-1].split("/", 1)[0].strip()


def assess(edit: Edit) -> Assessment:
    """Score an edit between 0 (normal) and 1 (very likely vandalism)."""
    signals: List[Signal] = []
    comment = edit.comment
    # Text the software wrote, not the editor: "/* Section name */" markers.
    # Found on the live stream: a section titled "IdiotSavant" tripped the
    # language rule. Size/explanation checks still use the full comment.
    own_words = _AUTO_SECTION.sub(" ", comment)
    old, new = edit.length_old, edit.length_new

    # --- content size ----------------------------------------------------
    # Skipped on user pages (namespace 2): people routinely clear their own
    # sandboxes and drafts. Found on the live stream (a nlwiki user sandbox).
    # Also skipped when someone clears their *own* talk page, which is allowed
    # (found live: "User talk:GingaCat" blanked by GingaCat).
    explained_removal = bool(_REDIRECT_OR_MERGE.search(comment))
    own_talk_page = edit.namespace == USER_TALK_NAMESPACE and _page_owner(edit.title) == edit.user
    if old and new is not None and edit.namespace != USER_NAMESPACE and not own_talk_page:
        removed = old - new
        ratio = removed / old if old else 0.0
        if explained_removal:
            pass  # merge/redirect: size drop is expected
        elif new < 100 and old >= 1000:
            signals.append(Signal("blanking", 0.6, f"page cut from {old} to {new} bytes"))
        elif removed >= 5000 or (removed >= MIN_RATIO_REMOVAL and ratio >= 0.5):
            signals.append(Signal("large_removal", 0.45, f"removed {removed} bytes ({ratio:.0%} of the page)"))
        elif removed >= MIN_RATIO_REMOVAL and ratio >= 0.3:
            signals.append(Signal("removal", 0.2, f"removed {ratio:.0%} of the page"))
        if abs(new - old) >= 1000 and not comment:
            signals.append(Signal("no_summary", 0.15, "large change without an edit summary"))

    # --- edit summary -----------------------------------------------------
    if _INJECTION.search(comment):
        signals.append(Signal(
            "prompt_injection", 0.55,
            "edit summary contains instructions aimed at automated moderation",
        ))
    if _MARKUP.search(comment):
        signals.append(Signal("markup", 0.4, "edit summary contains HTML/script code"))
    if _PROFANITY.search(own_words):
        signals.append(Signal("profanity", 0.4, "offensive or juvenile language in the summary"))
    if _shouting(own_words):
        signals.append(Signal("shouting", 0.2, "summary is mostly capital letters"))
    if _REPEATED.search(own_words):
        signals.append(Signal("repeated_chars", 0.2, "repeated characters in the summary"))

    # --- who --------------------------------------------------------------
    if edit.anonymous:
        signals.append(Signal("anonymous", 0.15, "logged-out editor (IP or temporary account)"))

    # Combine independent signals: 1 - Π(1 - w). Never exceeds 1.
    remaining = 1.0
    for s in signals:
        remaining *= 1 - s.weight
    score = 1 - remaining

    # Registered bots are rarely vandals, so soften size/language signals.
    # Not for injection or markup: those are attacks on *us*, whoever sends them.
    if edit.bot and not any(s.code in ("prompt_injection", "markup") for s in signals):
        score *= 0.3

    return Assessment(round(score, 3), tuple(signals))
