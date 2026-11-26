"""Daily AI spending limit in US dollars.

Every call's token usage is converted to dollars with the model's price per
million tokens and added to today's total. Before a call is sent, its
*worst case* cost (estimated input + the full ``max_tokens`` of output) is
reserved against what is left; when the call ends the reservation is swapped
for the real cost. So the limit is never crossed, not even by several calls
running at once or by the call that would reach it.

Today's spend is saved to a small JSON file, so restarting the app does not
reset the limit. The day rolls over at 00:00 UTC.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

log = logging.getLogger(__name__)

# Rough characters-per-token for the pre-call estimate. Real tokenizers average
# ~4 characters per token for English; 3 over-estimates, which errs on the safe
# side (and non-Latin text uses more tokens per character).
CHARS_PER_TOKEN = 3


class BudgetExceeded(RuntimeError):
    pass


class DailyBudget:
    def __init__(
        self,
        limit_usd: float,
        price_input_per_m: float,
        price_output_per_m: float,
        path: Optional[Path] = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.limit_usd = limit_usd
        self.price_input_per_m = price_input_per_m
        self.price_output_per_m = price_output_per_m
        self.path = path
        self._clock = clock
        self.day = self._today()
        self.spent_usd = 0.0
        self.input_tokens = 0
        self.output_tokens = 0
        self.calls = 0
        self.blocked = 0
        self.reserved_usd = 0.0  # worst-case cost of calls still running
        self._load()

    # ------------------------------------------------------------------ #
    def cost(self, input_tokens: int, output_tokens: int) -> float:
        return (input_tokens * self.price_input_per_m + output_tokens * self.price_output_per_m) / 1_000_000

    def reserve(self, prompt_chars: int, max_output_tokens: int) -> float:
        """Hold this call's worst-case cost, or raise ``BudgetExceeded`` if it might not fit.

        Returns the amount held; pass it to ``record`` (or ``release``) when the call ends.
        """
        self._roll()
        worst = self.cost(prompt_chars // CHARS_PER_TOKEN + 1, max_output_tokens)
        if self.spent_usd + self.reserved_usd + worst > self.limit_usd:
            self.blocked += 1
            raise BudgetExceeded(
                f"daily AI budget of ${self.limit_usd:.2f} reached "
                f"(${self.spent_usd:.2f} spent); AI resumes at 00:00 UTC"
            )
        self.reserved_usd += worst
        return worst

    def release(self, held: float) -> None:
        """The call failed before using anything: give its reservation back."""
        self.reserved_usd = max(0.0, self.reserved_usd - held)

    def record(self, input_tokens: int, output_tokens: int, held: float = 0.0) -> None:
        """The call finished: replace its reservation with what it really cost."""
        self.release(held)
        self._roll()
        self.spent_usd += self.cost(input_tokens, output_tokens)
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.calls += 1
        self._save()

    def status(self) -> Dict[str, Any]:
        self._roll()
        return {
            "day": self.day,
            "limit_usd": round(self.limit_usd, 4),
            "spent_usd": round(self.spent_usd, 4),
            "remaining_usd": round(max(0.0, self.limit_usd - self.spent_usd), 4),
            "calls": self.calls,
            "blocked_calls": self.blocked,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "price_per_million_tokens": {"input": self.price_input_per_m, "output": self.price_output_per_m},
        }

    # ------------------------------------------------------------------ #
    def _today(self) -> str:
        return datetime.fromtimestamp(self._clock(), tz=timezone.utc).strftime("%Y-%m-%d")

    def _roll(self) -> None:
        today = self._today()
        if today != self.day:
            self.day = today
            self.spent_usd = 0.0
            self.input_tokens = self.output_tokens = self.calls = self.blocked = 0

    def _load(self) -> None:
        if not self.path or not self.path.is_file():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            log.warning("could not read %s; starting today's AI spend at $0", self.path)
            return
        if data.get("day") == self.day:
            self.spent_usd = float(data.get("spent_usd", 0.0))
            self.input_tokens = int(data.get("input_tokens", 0))
            self.output_tokens = int(data.get("output_tokens", 0))
            self.calls = int(data.get("calls", 0))

    def _save(self) -> None:
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(
                json.dumps({
                    "day": self.day,
                    "spent_usd": self.spent_usd,
                    "input_tokens": self.input_tokens,
                    "output_tokens": self.output_tokens,
                    "calls": self.calls,
                }),
                encoding="utf-8",
            )
            tmp.replace(self.path)  # atomic: a crash never leaves a half-written file
        except OSError:
            log.warning("could not save AI spend to %s", self.path)
