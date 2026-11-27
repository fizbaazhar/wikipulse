"""FastAPI application: builds the services and wires up the routes.

Run with ``uvicorn --factory app.main:create_app``. The routes live in
``app/api/`` and the WebSocket protocol is documented in ``app/api/ws.py``.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ai.assistant import Assistant
from .ai.budget import DailyBudget
from .ai.diffs import DiffFetcher
from .ai.llm import AnthropicLLM, AzureOpenAILLM, LLMClient, OpenAILLM, RateLimiter
from .ai.moderator import Moderator
from .ai.pulse import PulseService
from .api import ai, data, session, ws
from .auth import Auth, LoginThrottle
from .config import Settings
from .hub import Hub
from .pipeline import Pipeline
from .sources import LiveSource, ReplaySource
from .stats import RollingStats
from .web import mount_dashboard

log = logging.getLogger("wikipulse")


def build_source(settings: Settings) -> Any:
    if settings.source == "replay":
        return ReplaySource(settings.replay_file, speed=settings.replay_speed, loop=settings.replay_loop)
    return LiveSource(settings.stream_url, settings.user_agent)


def build_llm(settings: Settings) -> Optional[LLMClient]:
    """The configured AI client with its daily dollar budget, or None (rules only)."""
    if settings.ai_problem:
        log.warning("AI disabled: %s", settings.ai_problem)
    if not settings.ai_enabled:
        return None
    key = settings.llm_api_key or ""
    llm: Any
    if settings.llm_provider == "azure":
        llm = AzureOpenAILLM(
            api_key=key,
            endpoint=settings.azure_endpoint or "",
            deployment=settings.llm_model,
            api_version=settings.azure_api_version,
            effort=settings.llm_effort,
        )
    elif settings.llm_provider == "openai":
        llm = OpenAILLM(api_key=key, model=settings.llm_model, effort=settings.llm_effort)
    else:
        llm = AnthropicLLM(
            api_key=key, model=settings.llm_model, effort=settings.llm_effort, use_fallbacks=settings.llm_fallbacks
        )
    if settings.llm_daily_budget_usd > 0:
        llm.budget = DailyBudget(
            settings.llm_daily_budget_usd,
            settings.llm_price_input_per_m,
            settings.llm_price_output_per_m,
            path=settings.llm_spend_file,
        )
        log.info("AI daily budget: $%.2f", settings.llm_daily_budget_usd)
    return llm


def _log_crash(task: asyncio.Task) -> None:
    """Background loops should run until shutdown; say so loudly if one dies."""
    if not task.cancelled() and task.exception() is not None:
        log.error("background task %s stopped", task.get_name(), exc_info=task.exception())


def create_app(
    settings: Optional[Settings] = None,
    source: Any = None,
    llm: Optional[LLMClient] = None,
    auth: Optional[Auth] = None,
) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = settings or Settings.from_env()
    auth = auth or Auth(
        settings.auth_username,
        settings.auth_password,
        secret=settings.session_secret,
        session_hours=settings.session_hours,
    )
    if auth.enabled:
        log.info("Login required (user %r)", auth.username)
    else:
        log.warning("Login is OFF: set WIKIPULSE_AUTH_PASSWORD in backend/.env to require it")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        model = llm if llm is not None else build_llm(settings)
        # Pulse and vandalism review share one hourly limit; the chat has its
        # own, so background work never uses up a person's questions. All of
        # them share the daily dollar budget on the client.
        limiter = RateLimiter(settings.llm_max_calls_per_hour)
        chat_limiter = RateLimiter(settings.llm_assistant_calls_per_hour)
        stats = RollingStats(settings.window_seconds, settings.history_minutes)
        # The diff is only for the AI review, so it is fetched only when AI is on.
        diffs = DiffFetcher(settings.user_agent) if model is not None and settings.fetch_diffs else None
        moderator = Moderator(
            model, limiter, diffs=diffs, batch_size=settings.review_batch_size, interval=settings.review_interval
        )
        pulse = PulseService(
            stats, model, limiter,
            flagged_count=lambda: sum(1 for f in moderator.recent_flagged() if f["flag"]["status"] == "flagged"),
            interval=settings.pulse_interval,
        )
        pipeline = Pipeline(source or build_source(settings), stats, moderator=moderator)
        hub = Hub(pipeline, stats, interval=settings.tick_seconds, moderator=moderator, pulse=pulse)
        assistant = Assistant(
            snapshot=stats.snapshot, flagged=hub.flagged, pulse=lambda: pulse.current, llm=model, limiter=chat_limiter
        )
        state = app.state
        state.llm, state.limiter, state.chat_limiter = model, limiter, chat_limiter
        state.stats, state.pipeline, state.hub = stats, pipeline, hub
        state.moderator, state.pulse, state.assistant = moderator, pulse, assistant

        loops = [pipeline.run(), hub.run(), pulse.run()] + ([moderator.run()] if model is not None else [])
        names = ["pipeline", "hub", "pulse", "moderator"]
        tasks = [asyncio.create_task(loop, name=name) for loop, name in zip(loops, names)]
        for task in tasks:
            task.add_done_callback(_log_crash)
        log.info(
            "WikiPulse started with %s source; AI %s",
            pipeline.source.name,
            f"on ({getattr(model, 'model', 'custom')})" if model else "off (rules only)",
        )
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if diffs is not None:
                await diffs.aclose()

    # With login on, the API docs are hidden too: they list every route.
    docs = {} if not auth.enabled else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="WikiPulse", version="0.1.0", lifespan=lifespan, **docs)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.middleware("http")(session.require_login)
    app.state.settings, app.state.auth, app.state.login_throttle = settings, auth, LoginThrottle()
    for module in (session, data, ai, ws):
        app.include_router(module.router)
    if settings.static_dir is not None:
        mount_dashboard(app, settings.static_dir)  # last, so the API routes win
    return app
