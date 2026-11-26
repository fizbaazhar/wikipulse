"""Login, logout and the guard that keeps ``/api`` behind a session."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import COOKIE_NAME
from .deps import current_user

log = logging.getLogger("wikipulse")

router = APIRouter(prefix="/api/auth")

# Reachable without a session: login itself, and the bare health check.
PUBLIC_PATHS = {"/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/health"}


async def require_login(request: Request, call_next: Any) -> Any:
    """HTTP middleware: every ``/api`` route except ``PUBLIC_PATHS`` needs a session."""
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_PATHS and current_user(request) is None:
        return JSONResponse({"detail": "login required"}, status_code=401)
    return await call_next(request)


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=500)


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response) -> Any:
    auth, throttle = request.app.state.auth, request.app.state.login_throttle
    if not auth.enabled:
        return {"user": None, "auth_enabled": False}
    # Behind nginx this is the browser's address (uvicorn --proxy-headers).
    client = request.client.host if request.client else "unknown"
    if throttle.blocked(client):
        return JSONResponse(
            {"detail": "Too many attempts. Try again in a few minutes."},
            status_code=429,
            headers={"Retry-After": str(throttle.retry_after(client))},
        )
    if not auth.check_password(body.username, body.password):
        throttle.fail(client)
        log.warning("Failed login for %r from %s", body.username[:50], client)
        return JSONResponse({"detail": "Wrong username or password."}, status_code=401)
    throttle.reset(client)
    response.set_cookie(
        COOKIE_NAME,
        auth.issue(auth.username),
        max_age=auth.max_age,
        httponly=True,
        samesite="strict",
        secure=request.app.state.settings.cookie_secure,
        path="/",
    )
    return {"user": auth.username, "auth_enabled": True}


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict:
    secure = request.app.state.settings.cookie_secure
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="strict", secure=secure)
    return {"user": None, "auth_enabled": request.app.state.auth.enabled}


@router.get("/me")
async def me(request: Request) -> dict:
    return {"auth_enabled": request.app.state.auth.enabled, "user": current_user(request) or None}
