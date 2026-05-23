from arq import cron
from arq.connections import RedisSettings

from husn.connectors.jira.backfill import backfill_connection as jira_backfill_connection
from husn.connectors.jira.backfill import get_connections as jira_get_connections
from husn.connectors.slack.backfill import backfill_connection as slack_backfill_connection
from husn.connectors.slack.backfill import get_connections as slack_get_connections
from husn.core.config import get_settings
from husn.core.logging import configure_logging, log
from husn.db.session import SessionLocal
from husn.graph.normalize import normalize_pending as graph_normalize_pending

settings = get_settings()


async def startup(ctx: dict) -> None:
    configure_logging(settings.log_level)
    log.info("husn.worker.startup")


async def shutdown(ctx: dict) -> None:
    log.info("husn.worker.shutdown")


async def heartbeat(ctx: dict) -> str:
    log.info("husn.worker.heartbeat")
    return "ok"


async def _resolve_connections(session, source: str, connection_id: int | None, get_all):
    if connection_id is None:
        return await get_all(session)
    from sqlalchemy import select
    from husn.db.models import Connection

    result = await session.execute(
        select(Connection).where(Connection.id == connection_id, Connection.source == source)
    )
    return list(result.scalars().all())


async def jira_backfill(ctx: dict, connection_id: int | None = None) -> dict:
    summary: dict[int, dict] = {}
    async with SessionLocal() as session:
        connections = await _resolve_connections(session, "jira", connection_id, jira_get_connections)
        for conn in connections:
            summary[conn.id] = await jira_backfill_connection(session, conn)
    log.info("husn.worker.jira_backfill.done", summary=summary)
    return summary


async def slack_backfill(ctx: dict, connection_id: int | None = None) -> dict:
    summary: dict[int, dict] = {}
    async with SessionLocal() as session:
        connections = await _resolve_connections(session, "slack", connection_id, slack_get_connections)
        for conn in connections:
            summary[conn.id] = await slack_backfill_connection(session, conn)
    log.info("husn.worker.slack_backfill.done", summary=summary)
    return summary


async def normalize_graph(ctx: dict) -> dict:
    """Sweep new raw_artifacts into the operational graph. Idempotent."""
    async with SessionLocal() as session:
        return await graph_normalize_pending(session)


# Cron schedules — drift-tolerant offsets so the three jobs don't pile up.
# Arq cron uses cron-style sets; second/minute granularity is plenty for MVP.
_BACKFILL_SECONDS = set(range(0, 60, 60))  # once per minute on :00
_BACKFILL_SLACK_SECONDS = set(range(30, 60, 60))  # ...and :30 for Slack — 30s offset
_NORMALIZE_SECONDS = set(range(0, 60, 15))  # every 15 seconds


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions: list = [heartbeat, jira_backfill, slack_backfill, normalize_graph]
    cron_jobs = [
        cron(jira_backfill, second=_BACKFILL_SECONDS, run_at_startup=True),
        cron(slack_backfill, second=_BACKFILL_SLACK_SECONDS, run_at_startup=True),
        cron(normalize_graph, second=_NORMALIZE_SECONDS, run_at_startup=True),
    ]
    on_startup = startup
    on_shutdown = shutdown
