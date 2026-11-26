"""Event sources. Each yields raw JSON strings, one event per item.

Both sources share the same tiny interface (``name``, ``lines()``, ``status()``)
so the rest of the pipeline does not know or care whether data is live.
"""
from .live import LiveSource
from .replay import ReplaySource

__all__ = ["LiveSource", "ReplaySource"]
