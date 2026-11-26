"""Live source: Wikimedia EventStreams over Server-Sent Events.

* Parses SSE per the spec (multi-line ``data``, comments, ``id`` field).
* Reconnects forever with exponential backoff + jitter.
* Sends ``Last-Event-ID`` on reconnect so the stream resumes where it left
  off; any events redelivered as a result are removed by the ``Deduper``.
"""
from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

log = logging.getLogger(__name__)

DEFAULT_STREAM_URL = "https://stream.wikimedia.org/v2/stream/recentchange"
# Wikimedia asks automated clients to send a descriptive User-Agent.
DEFAULT_USER_AGENT = "WikiPulse/0.1 (take-home demo dashboard; python-httpx)"


@dataclass
class SSEEvent:
    data: str
    event: Optional[str] = None
    id: Optional[str] = None


async def iter_sse(lines: AsyncIterator[str]) -> AsyncIterator[SSEEvent]:
    """Group raw text lines into SSE events (https://html.spec.whatwg.org/#server-sent-events)."""
    data: List[str] = []
    event: Optional[str] = None
    event_id: Optional[str] = None
    async for line in lines:
        line = line.rstrip("\r")
        if line == "":
            if data:
                yield SSEEvent(data="\n".join(data), event=event, id=event_id)
            data, event, event_id = [], None, None
            continue
        if line.startswith(":"):
            continue  # comment / keep-alive
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            data.append(value)
        elif field == "event":
            event = value
        elif field == "id":
            event_id = value
    if data:
        yield SSEEvent(data="\n".join(data), event=event, id=event_id)


class LiveSource:
    name = "live"

    def __init__(
        self,
        url: str = DEFAULT_STREAM_URL,
        user_agent: str = DEFAULT_USER_AGENT,
        max_backoff: float = 30.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.url = url
        self.user_agent = user_agent
        self.max_backoff = max_backoff
        self._transport = transport  # injectable for tests
        self.connected = False
        self.reconnects = 0
        self.last_error: Optional[str] = None
        self._last_event_id: Optional[str] = None

    async def lines(self) -> AsyncIterator[str]:
        backoff = 1.0
        while True:
            headers = {"Accept": "text/event-stream", "User-Agent": self.user_agent}
            if self._last_event_id:
                headers["Last-Event-ID"] = self._last_event_id
            try:
                timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
                async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
                    async with client.stream("GET", self.url, headers=headers) as resp:
                        resp.raise_for_status()
                        self.connected, self.last_error, backoff = True, None, 1.0
                        log.info("connected to %s", self.url)
                        async for ev in iter_sse(resp.aiter_lines()):
                            if ev.id:
                                self._last_event_id = ev.id
                            if ev.event in (None, "message") and ev.data:
                                yield ev.data
                self.last_error = "stream closed by server"
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # network errors, HTTP errors, timeouts
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.warning("stream error: %s", self.last_error)

            self.connected = False
            self.reconnects += 1
            delay = backoff + random.uniform(0, backoff / 2)
            log.info("reconnecting in %.1fs", delay)
            await asyncio.sleep(delay)
            backoff = min(backoff * 2, self.max_backoff)

    def status(self) -> Dict[str, Any]:
        return {
            "source": self.name,
            "url": self.url,
            "connected": self.connected,
            "reconnects": self.reconnects,
            "last_error": self.last_error,
        }
