"""Settings read from environment variables (and an optional ``backend/.env``)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from .ai.llm import DEFAULT_AZURE_API_VERSION, DEFAULT_MODELS
from .sources.live import DEFAULT_STREAM_URL, DEFAULT_USER_AGENT

KEY_VARS = {"azure": "AZURE_OPENAI_API_KEY", "openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_REPLAY_FILE = BACKEND_DIR / "data" / "sample_events.jsonl"


def _bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_dotenv(path: Path) -> None:
    """Minimal ``.env`` reader: KEY=VALUE lines; real env vars take precedence."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass
class Settings:
    source: str = "live"  # "live" or "replay"
    stream_url: str = DEFAULT_STREAM_URL
    user_agent: str = DEFAULT_USER_AGENT
    replay_file: Path = DEFAULT_REPLAY_FILE
    replay_speed: float = 1.0
    replay_loop: bool = True
    window_seconds: int = 300
    history_minutes: int = 30
    tick_seconds: float = 1.0
    cors_origins: List[str] = field(default_factory=lambda: ["http://localhost:5173"])

    # --- AI -----------------------------------------------------------------
    llm_provider: str = "openai"  # "azure", "openai" or "anthropic"
    llm_api_key: Optional[str] = None  # no key → rules-only mode
    llm_model: str = DEFAULT_MODELS["openai"]  # on Azure: the deployment name
    azure_endpoint: Optional[str] = None
    azure_api_version: str = DEFAULT_AZURE_API_VERSION
    llm_effort: str = "low"
    llm_fallbacks: bool = True
    llm_max_calls_per_hour: int = 60  # shared by Pulse + vandalism review
    # The chat has its own hourly allowance, so background vandalism review
    # can never use up the calls a person is waiting on. The dollar budget is shared.
    llm_assistant_calls_per_hour: int = 30
    # Daily dollar limit for all AI calls (0 = no dollar limit). Prices are
    # per 1M tokens and must match the deployed model; the defaults are
    # deliberately high so an unset price over-estimates rather than overspends.
    llm_daily_budget_usd: float = 1.0
    llm_price_input_per_m: float = 2.50
    llm_price_output_per_m: float = 10.00
    llm_spend_file: Path = BACKEND_DIR / ".state" / "llm_spend.json"
    pulse_interval: float = 60.0
    review_interval: float = 5.0
    review_batch_size: int = 8

    # --- Login ----------------------------------------------------------------
    # No password = login off (local development and tests).
    auth_username: str = "admin"
    auth_password: Optional[str] = None
    session_secret: Optional[str] = None  # None = random per process
    session_hours: float = 12.0
    cookie_secure: bool = False  # set true when served over HTTPS
    # Built dashboard to serve from the back end (single-service deploys); None = don't.
    static_dir: Optional[Path] = None

    @property
    def ai_problem(self) -> Optional[str]:
        """Why AI cannot start with these settings (None when it can)."""
        if not self.llm_api_key:
            return None  # no key: rules-only mode by choice, not a problem
        if self.llm_provider == "azure":
            if not self.azure_endpoint:
                return "AZURE_OPENAI_ENDPOINT is not set"
            if not self.llm_model:
                return "AZURE_OPENAI_DEPLOYMENT is not set (the deployment name from the Azure portal)"
        return None

    @property
    def ai_enabled(self) -> bool:
        return bool(self.llm_api_key) and self.ai_problem is None

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(BACKEND_DIR / ".env")
        env = os.environ
        source = env.get("WIKIPULSE_SOURCE", "live").strip().lower()
        if source not in {"live", "replay"}:
            raise ValueError(f"WIKIPULSE_SOURCE must be 'live' or 'replay', got {source!r}")
        ai_off = env.get("WIKIPULSE_AI", "on").strip().lower() in {"off", "0", "false", "no"}

        # Provider: explicit setting, otherwise the first one with a key
        # (Azure OpenAI, then OpenAI, then Anthropic).
        provider = env.get("WIKIPULSE_LLM_PROVIDER", "").strip().lower()
        if not provider:
            provider = next((p for p, var in KEY_VARS.items() if env.get(var)), "openai")
        if provider not in KEY_VARS:
            raise ValueError(f"WIKIPULSE_LLM_PROVIDER must be one of {sorted(KEY_VARS)}, got {provider!r}")
        api_key = env.get(KEY_VARS[provider]) or None
        model = env.get("WIKIPULSE_LLM_MODEL") or (
            env.get("AZURE_OPENAI_DEPLOYMENT", "").strip() if provider == "azure" else DEFAULT_MODELS[provider]
        )

        return cls(
            source=source,
            stream_url=env.get("WIKIPULSE_STREAM_URL", DEFAULT_STREAM_URL),
            user_agent=env.get("WIKIPULSE_USER_AGENT", DEFAULT_USER_AGENT),
            replay_file=Path(env.get("WIKIPULSE_REPLAY_FILE", str(DEFAULT_REPLAY_FILE))),
            replay_speed=float(env.get("WIKIPULSE_REPLAY_SPEED", "1")),
            replay_loop=_bool(env.get("WIKIPULSE_REPLAY_LOOP", "true")),
            window_seconds=int(env.get("WIKIPULSE_WINDOW_SECONDS", "300")),
            tick_seconds=float(env.get("WIKIPULSE_TICK_SECONDS", "1")),
            cors_origins=[
                o.strip()
                for o in env.get("WIKIPULSE_CORS_ORIGINS", "http://localhost:5173").split(",")
                if o.strip()
            ],
            llm_provider=provider,
            llm_api_key=None if ai_off else api_key,
            llm_model=model,
            azure_endpoint=(env.get("AZURE_OPENAI_ENDPOINT") or "").strip() or None,
            azure_api_version=(env.get("AZURE_OPENAI_API_VERSION") or "").strip() or DEFAULT_AZURE_API_VERSION,
            llm_effort=env.get("WIKIPULSE_LLM_EFFORT", "low"),
            llm_fallbacks=_bool(env.get("WIKIPULSE_LLM_FALLBACKS", "true")),
            llm_max_calls_per_hour=int(env.get("WIKIPULSE_LLM_MAX_CALLS_PER_HOUR", "60")),
            llm_assistant_calls_per_hour=int(env.get("WIKIPULSE_LLM_ASSISTANT_CALLS_PER_HOUR", "30")),
            llm_daily_budget_usd=float(env.get("WIKIPULSE_LLM_DAILY_BUDGET_USD", "1.00")),
            llm_price_input_per_m=float(env.get("WIKIPULSE_LLM_PRICE_INPUT_PER_M", "2.50")),
            llm_price_output_per_m=float(env.get("WIKIPULSE_LLM_PRICE_OUTPUT_PER_M", "10.00")),
            llm_spend_file=Path(env.get("WIKIPULSE_LLM_SPEND_FILE", str(BACKEND_DIR / ".state" / "llm_spend.json"))),
            pulse_interval=float(env.get("WIKIPULSE_PULSE_INTERVAL", "60")),
            review_interval=float(env.get("WIKIPULSE_REVIEW_INTERVAL", "5")),
            auth_username=(env.get("WIKIPULSE_AUTH_USERNAME") or "admin").strip(),
            auth_password=env.get("WIKIPULSE_AUTH_PASSWORD") or None,
            session_secret=env.get("WIKIPULSE_SESSION_SECRET") or None,
            session_hours=float(env.get("WIKIPULSE_SESSION_HOURS", "12")),
            cookie_secure=_bool(env.get("WIKIPULSE_COOKIE_SECURE", "false")),
            static_dir=Path(env["WIKIPULSE_STATIC_DIR"]) if env.get("WIKIPULSE_STATIC_DIR") else None,
        )
