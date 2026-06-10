from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


# Production env vars that MUST be set when env != "local". Listed once here so
# the startup fail-fast message and any future docs stay in sync.
_REQUIRED_PROD_ENV_VARS: tuple[str, ...] = (
    "DATABASE_URL",
    "REDIS_URL",
    "SESSION_SECRET",
    "PUBLIC_API_BASE_URL",
    "PUBLIC_WEB_BASE_URL",
    "CORS_ALLOWED_ORIGINS",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "local"
    log_level: str = "info"
    # "json" for prod (structured), "kv" for local-dev pretty key-value output.
    log_format: str = "json"

    database_url: str = "postgresql+asyncpg://husn:husn@postgres:5432/husn"
    redis_url: str = "redis://redis:6379/0"

    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # Public base URLs — used to build absolute OAuth redirect_uri values and
    # back-links into the web UI from server-rendered callback pages.
    # Local-dev defaults match docker-compose; prod must override via env.
    public_api_base_url: str = "http://localhost:8000"
    public_web_base_url: str = "http://localhost:3000"

    # Comma-separated list of origins allowed by the CORS middleware. Defaults
    # cover local-dev (Next.js on :3000 and direct API hits at :8000); prod
    # must set CORS_ALLOWED_ORIGINS=https://app.husn.io,https://husn.io.
    cors_allowed_origins: str = "http://localhost:3000,http://localhost:8000"

    # PROD-AUDIT: rotate — this default is a local-dev placeholder only.
    # Prod startup validation rejects this exact string; ops MUST supply
    # SESSION_SECRET via env (32+ bytes of `openssl rand -hex 32`).
    session_secret: str = "dev-only-not-secret-rotate-me"

    jira_client_id: str = ""
    jira_client_secret: str = ""
    # OAuth redirect_uri values default to {PUBLIC_API_BASE_URL}/auth/<provider>/callback
    # when unset; see `_provider_redirect_uri()` below.
    jira_redirect_uri: str = ""

    slack_client_id: str = ""
    slack_client_secret: str = ""
    slack_signing_secret: str = ""
    slack_redirect_uri: str = ""

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""

    ms_client_id: str = ""
    ms_client_secret: str = ""
    ms_tenant: str = "common"  # 'common' = personal + any work tenant
    ms_redirect_uri: str = ""

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

    # --- Auth + tenancy (TENANCY.md) -------------------------------------
    # AUTH_REQUIRED=0 keeps every endpoint open (the pre-cutover bridge).
    # Flipped to 1 in the C4 deploy. Anything but "0"/""/"false" counts as on.
    auth_required: bool = False
    # Cookie Domain. Prod: ".husn.io" so app. and api. share the session
    # cookie. Local-dev: empty → host-only cookie on localhost.
    cookie_domain: str = ""
    # Session lifetime (sliding) in days.
    session_ttl_days: int = 30
    # Resend (magic-link email). Blank = magic links log to stdout instead of
    # sending (local-dev affordance).
    resend_api_key: str = ""
    resend_from: str = "Husn <login@husn.io>"
    # Secret URL token for the Atlassian personal-data reporting endpoints.
    # Registered as part of the URL in the Atlassian dev console. Blank = check
    # disabled (dev / pre-cutover bridge).
    atlassian_reporting_token: str = ""

    # --- Derived helpers -------------------------------------------------

    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    def _provider_redirect_uri(self, configured: str, provider: str) -> str:
        if configured:
            return configured
        return f"{self.public_api_base_url.rstrip('/')}/auth/{provider}/callback"

    @property
    def jira_redirect_uri_resolved(self) -> str:
        return self._provider_redirect_uri(self.jira_redirect_uri, "jira")

    @property
    def slack_redirect_uri_resolved(self) -> str:
        return self._provider_redirect_uri(self.slack_redirect_uri, "slack")

    @property
    def google_redirect_uri_resolved(self) -> str:
        return self._provider_redirect_uri(self.google_redirect_uri, "google")

    @property
    def ms_redirect_uri_resolved(self) -> str:
        return self._provider_redirect_uri(self.ms_redirect_uri, "microsoft")


def _validate_production(s: Settings) -> None:
    """Fail-fast guard. Only runs when env != 'local'. Surfaces every missing
    var at once so an ops misconfig surfaces in one log line, not five reboots.
    """
    if s.env == "local":
        return
    import os

    missing: list[str] = [name for name in _REQUIRED_PROD_ENV_VARS if not os.environ.get(name)]
    # session_secret has a dev default that MUST be rotated in prod even if
    # the env var is technically "set" to the default string.
    if s.session_secret == "dev-only-not-secret-rotate-me":
        missing.append("SESSION_SECRET (still set to dev default)")
    if missing:
        raise RuntimeError(
            "husn.config: missing required production env vars: " + ", ".join(missing)
        )


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    _validate_production(s)
    return s
