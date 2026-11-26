from __future__ import annotations

import pytest

from app.config import Settings


@pytest.fixture
def env(monkeypatch, tmp_path):
    for key in (
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "WIKIPULSE_LLM_PROVIDER", "WIKIPULSE_LLM_MODEL", "WIKIPULSE_AI",
        "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_DEPLOYMENT",
        "WIKIPULSE_LLM_DAILY_BUDGET_USD", "WIKIPULSE_LLM_PRICE_INPUT_PER_M", "WIKIPULSE_LLM_PRICE_OUTPUT_PER_M",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr("app.config.BACKEND_DIR", tmp_path)  # ignore a real backend/.env
    return monkeypatch


def test_no_key_means_rules_only(env):
    assert Settings.from_env().ai_enabled is False


def test_openai_key_selects_openai(env):
    env.setenv("OPENAI_API_KEY", "sk-test")
    s = Settings.from_env()
    assert (s.llm_provider, s.llm_model, s.ai_enabled) == ("openai", "gpt-5.4-mini", True)


def test_anthropic_key_selects_anthropic(env):
    env.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    s = Settings.from_env()
    assert (s.llm_provider, s.llm_model) == ("anthropic", "claude-opus-5-5")


def test_explicit_provider_and_model_win(env):
    env.setenv("OPENAI_API_KEY", "sk-test")
    env.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    env.setenv("WIKIPULSE_LLM_PROVIDER", "anthropic")
    env.setenv("WIKIPULSE_LLM_MODEL", "claude-haiku-5-5")
    s = Settings.from_env()
    assert (s.llm_provider, s.llm_api_key, s.llm_model) == ("anthropic", "sk-ant-test", "claude-haiku-5-5")


def test_ai_can_be_switched_off(env):
    env.setenv("OPENAI_API_KEY", "sk-test")
    env.setenv("WIKIPULSE_AI", "off")
    assert Settings.from_env().ai_enabled is False


def test_unknown_provider_is_rejected(env):
    env.setenv("WIKIPULSE_LLM_PROVIDER", "gemini")
    with pytest.raises(ValueError):
        Settings.from_env()


def test_azure_key_selects_azure_with_deployment_endpoint_and_version(env):
    env.setenv("AZURE_OPENAI_API_KEY", "az-test")
    env.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    env.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini-prod")
    env.setenv("OPENAI_API_KEY", "sk-test")  # Azure wins when both are set
    s = Settings.from_env()
    assert (s.llm_provider, s.llm_api_key, s.llm_model) == ("azure", "az-test", "gpt-4o-mini-prod")
    assert s.azure_endpoint == "https://example.openai.azure.com/"
    assert s.azure_api_version == "2024-10-21"  # default when the variable is empty
    assert s.ai_enabled


def test_azure_without_deployment_explains_why_ai_is_off(env):
    env.setenv("AZURE_OPENAI_API_KEY", "az-test")
    env.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
    env.setenv("AZURE_OPENAI_API_VERSION", "")
    s = Settings.from_env()
    assert not s.ai_enabled
    assert "AZURE_OPENAI_DEPLOYMENT" in s.ai_problem


def test_dollar_budget_settings(env):
    env.setenv("WIKIPULSE_LLM_DAILY_BUDGET_USD", "0.50")
    env.setenv("WIKIPULSE_LLM_PRICE_INPUT_PER_M", "0.15")
    env.setenv("WIKIPULSE_LLM_PRICE_OUTPUT_PER_M", "0.60")
    s = Settings.from_env()
    assert (s.llm_daily_budget_usd, s.llm_price_input_per_m, s.llm_price_output_per_m) == (0.5, 0.15, 0.6)
