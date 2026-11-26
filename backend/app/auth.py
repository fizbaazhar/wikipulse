"""Login for the dashboard: one account from settings, signed session cookies.

Design
------
* The account (username + password) comes from ``backend/.env``, like the
  API keys. With no password set, auth is off (local development, tests).
* Passwords are compared with ``hmac.compare_digest`` (constant time).
* A session is a signed token ``base64(user|expires).hmac`` in an HttpOnly,
  SameSite=Strict cookie, so page scripts can't read it and other sites
  can't send it (this also blocks cross-site WebSocket hijacking).
* The signing secret comes from settings, or is random per process, in which
  case a restart simply logs everyone out.
* Failed logins are rate limited per client address.
* Sessions are stateless: signing out deletes the cookie, but a copied token
  stays valid until it expires (``session_hours``). Fine for one demo account.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections import deque
from typing import Callable, Deque, Dict, Optional

COOKIE_NAME = "wikipulse_session"


class LoginThrottle:
    """At most ``max_failures`` failed logins per ``window`` seconds per key."""

    def __init__(self, max_failures: int = 5, window: float = 300.0, clock: Callable[[], float] = time.time) -> None:
        self.max_failures = max_failures
        self.window = window
        self.clock = clock
        self._failures: Dict[str, Deque[float]] = {}

    def _recent(self, key: str) -> Deque[float]:
        q = self._failures.setdefault(key, deque())
        cutoff = self.clock() - self.window
        while q and q[0] <= cutoff:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        return len(self._recent(key)) >= self.max_failures

    def retry_after(self, key: str) -> int:
        q = self._recent(key)
        return max(1, int(q[0] + self.window - self.clock()) + 1) if q else 0

    def fail(self, key: str) -> None:
        self._recent(key).append(self.clock())
        if len(self._failures) > 10_000:  # bound memory under a spray of addresses
            for k in list(self._failures)[:5_000]:
                del self._failures[k]

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)


class Auth:
    def __init__(
        self,
        username: str,
        password: Optional[str],
        secret: Optional[str] = None,
        session_hours: float = 12.0,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.username = username
        self._password = password or None
        self._key = (secret or secrets.token_hex(32)).encode()
        self.max_age = int(session_hours * 3600)
        self.clock = clock

    @property
    def enabled(self) -> bool:
        return self._password is not None

    def check_password(self, username: str, password: str) -> bool:
        if not self.enabled:
            return False
        # Compare both fields every time, so timing doesn't reveal which was wrong.
        user_ok = hmac.compare_digest(username.encode(), self.username.encode())
        pass_ok = hmac.compare_digest(password.encode(), self._password.encode())  # type: ignore[union-attr]
        return user_ok and pass_ok

    def _sign(self, payload: bytes) -> str:
        return hmac.new(self._key, payload, hashlib.sha256).hexdigest()

    def issue(self, username: str) -> str:
        expires = int(self.clock()) + self.max_age
        payload = base64.urlsafe_b64encode(f"{username}|{expires}".encode()).decode()
        return f"{payload}.{self._sign(payload.encode())}"

    def verify(self, token: Optional[str]) -> Optional[str]:
        """The username in a valid, unexpired token, else None."""
        if not token or token.count(".") != 1:
            return None
        payload, signature = token.split(".")
        # Compare bytes: a cookie can hold any text, and comparing non-ASCII str raises.
        expected = self._sign(payload.encode("utf-8", "replace"))
        if not hmac.compare_digest(signature.encode("utf-8", "replace"), expected.encode()):
            return None
        try:
            username, expires = base64.urlsafe_b64decode(payload.encode()).decode().rsplit("|", 1)
            if int(expires) < self.clock():
                return None
        except (ValueError, UnicodeDecodeError):
            return None
        return username if hmac.compare_digest(username.encode(), self.username.encode()) else None
