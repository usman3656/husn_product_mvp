from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "local"
    log_level: str = "info"

    database_url: str = "postgresql+asyncpg://husn:husn@postgres:5432/husn"
    redis_url: str = "redis://redis:6379/0"

    api_host: str = "0.0.0.0"
    api_port: int = 8000

    session_secret: str = "dev-only-not-secret-rotate-me"

    jira_client_id: str = ""
    jira_client_secret: str = ""
    jira_redirect_uri: str = "http://localhost:8000/auth/jira/callback"

    slack_client_id: str = ""
    slack_client_secret: str = ""
    slack_signing_secret: str = ""
    slack_redirect_uri: str = "http://localhost:8000/auth/slack/callback"

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    # LLM backend for the Step 6 agent. Provider determines which client is used;
    # each provider gets its own base_url + model fields below.
    llm_provider: str = "ollama"  # ollama | groq | anthropic | claude_cli
    llm_request_timeout_s: int = 180

    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "qwen2.5:14b"

    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"


@lru_cache
def get_settings() -> Settings:
    return Settings()
