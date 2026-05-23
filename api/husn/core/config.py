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


@lru_cache
def get_settings() -> Settings:
    return Settings()
