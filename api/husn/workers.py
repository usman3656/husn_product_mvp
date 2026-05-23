from arq.connections import RedisSettings

from husn.core.config import get_settings
from husn.core.logging import configure_logging, log

settings = get_settings()


async def startup(ctx: dict) -> None:
    configure_logging(settings.log_level)
    log.info("husn.worker.startup")


async def shutdown(ctx: dict) -> None:
    log.info("husn.worker.shutdown")


async def heartbeat(ctx: dict) -> str:
    """Smoke task — proves the worker can run and log."""
    log.info("husn.worker.heartbeat")
    return "ok"


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions: list = [heartbeat]
    on_startup = startup
    on_shutdown = shutdown
