"""Helpers shared by the routes. Services live on ``app.state`` (set up in ``main.py``)."""
from __future__ import annotations

from typing import Optional

from fastapi import Query
from starlette.requests import HTTPConnection

from ..auth import COOKIE_NAME
from ..wikis import WIKI_ID_PATTERN


def current_user(conn: HTTPConnection) -> Optional[str]:
    """Signed-in username; "" when login is off (everyone allowed); None if not signed in."""
    auth = conn.app.state.auth
    if not auth.enabled:
        return ""
    return auth.verify(conn.cookies.get(COOKIE_NAME))


WikiFilter = Query(None, pattern=WIKI_ID_PATTERN, description="Only this wiki, e.g. enwiki")
