from arq import create_pool, cron
from arq.connections import RedisSettings
from sqlalchemy import text

from husn.agent.run_v2 import run_renderer_for_all_projects
from husn.claims.extract import extract_pending as claims_extract_pending
from husn.connectors.google.backfill import backfill_connection as google_backfill_connection
from husn.connectors.google.backfill import get_connections as google_get_connections
from husn.connectors.granola.backfill import backfill_connection as granola_backfill_connection
from husn.connectors.granola.backfill import get_connections as granola_get_connections
from husn.connectors.jira.backfill import backfill_connection as jira_backfill_connection
from husn.connectors.jira.backfill import get_connections as jira_get_connections
from husn.connectors.microsoft.backfill import backfill_connection as microsoft_backfill_connection
from husn.connectors.microsoft.backfill import get_connections as microsoft_get_connections
from husn.connectors.slack.backfill import backfill_connection as slack_backfill_connection
from husn.connectors.slack.backfill import get_connections as slack_get_connections
from husn.core.config import get_settings
from husn.core.logging import configure_logging, log
from husn.db.session import SessionLocal
from husn.drift.evaluate import evaluate_drift as drift_evaluate
from husn.graph.normalize import normalize_pending as graph_normalize_pending

settings = get_settings()


async def startup(ctx: dict) -> None:
    configure_logging(settings.log_level, settings.log_format)
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


async def google_backfill(ctx: dict, connection_id: int | None = None) -> dict:
    summary: dict[int, dict] = {}
    async with SessionLocal() as session:
        connections = await _resolve_connections(
            session, "google", connection_id, google_get_connections
        )
        for conn in connections:
            summary[conn.id] = await google_backfill_connection(session, conn)
    log.info("husn.worker.google_backfill.done", summary=summary)
    return summary


async def microsoft_backfill(ctx: dict, connection_id: int | None = None) -> dict:
    summary: dict[int, dict] = {}
    async with SessionLocal() as session:
        connections = await _resolve_connections(
            session, "microsoft", connection_id, microsoft_get_connections
        )
        for conn in connections:
            summary[conn.id] = await microsoft_backfill_connection(session, conn)
    log.info("husn.worker.microsoft_backfill.done", summary=summary)
    return summary


async def granola_backfill(ctx: dict, connection_id: int | None = None) -> dict:
    summary: dict[int, dict] = {}
    async with SessionLocal() as session:
        connections = await _resolve_connections(
            session, "granola", connection_id, granola_get_connections
        )
        for conn in connections:
            summary[conn.id] = await granola_backfill_connection(session, conn)
    log.info("husn.worker.granola_backfill.done", summary=summary)
    return summary


async def normalize_graph(ctx: dict) -> dict:
    """Sweep new raw_artifacts into the operational graph. Idempotent."""
    async with SessionLocal() as session:
        return await graph_normalize_pending(session)


async def extract_claims(ctx: dict) -> dict:
    """Sweep new artifacts → run all applicable claim extractors. Idempotent."""
    async with SessionLocal() as session:
        return await claims_extract_pending(session)


async def evaluate_drift(ctx: dict) -> dict:
    """Assign claims to groups, evaluate drift rules, open/close findings."""
    async with SessionLocal() as session:
        return await drift_evaluate(session)


async def run_agent(ctx: dict) -> dict:
    """Step 6 agent — runs LLM analysis over each project. Cron every 30 min.

    NOT run_at_startup: a single run can take ~30s on Ollama with a real
    dossier, and we don't want it blocking the worker's normal boot. The
    first cron tick (at :00 or :30) will pick it up.
    """
    async with SessionLocal() as session:
        return await run_renderer_for_all_projects(session, trigger="cron")


# Manual "Sync now" pipeline — ingest sources, then derive, then render, in
# order. Single source of truth for the ordering; the API just enqueues
# `sync_pipeline`.
_SYNC_PIPELINE: tuple = (
    ("jira_backfill", jira_backfill),
    ("slack_backfill", slack_backfill),
    ("google_backfill", google_backfill),
    ("microsoft_backfill", microsoft_backfill),
    ("granola_backfill", granola_backfill),
    ("normalize_graph", normalize_graph),
    ("extract_claims", extract_claims),
    ("evaluate_drift", evaluate_drift),
    ("run_agent", run_agent),
)


async def sync_pipeline(ctx: dict) -> dict:
    """One-click 'Sync now' — run the whole ingest → derive → render pipeline
    sequentially in a single job so the render step sees freshly-backfilled
    data instead of racing it (the cron crons stagger these across the minute;
    a manual refresh can't rely on that timing). Every step is idempotent, and
    a failing source is logged and skipped so one bad connector doesn't abort
    the briefing refresh.
    """
    out: dict = {}
    for name, fn in _SYNC_PIPELINE:
        try:
            out[name] = await fn(ctx)
        except Exception as e:  # noqa: BLE001 — one bad step shouldn't abort the rest
            log.exception("husn.worker.sync_pipeline.step_failed", step=name)
            out[name] = {"error": f"{type(e).__name__}: {e}"}
    log.info("husn.worker.sync_pipeline.done")
    return out


async def auto_sync_tick(ctx: dict) -> dict:
    """Fires every minute, but only enqueues the full sync_pipeline when sync
    mode is 'automatic' AND interval_minutes have elapsed since the last run.

    Manual mode (the default) → no-op: nothing ingests/renders automatically,
    only the 'Sync now' button does. The elapsed-check + timestamp stamp is a
    single atomic UPDATE ... RETURNING so two concurrent ticks can't double-fire,
    and so a long pipeline doesn't get re-triggered before it finishes.
    """
    async with SessionLocal() as session:
        claimed = (
            await session.execute(
                text(
                    """
                    UPDATE sync_settings
                       SET last_run_at = now()
                     WHERE id = 1
                       AND mode = 'automatic'
                       AND (last_run_at IS NULL
                            OR last_run_at < now() - make_interval(mins => interval_minutes))
                    RETURNING id
                    """
                )
            )
        ).first()
        await session.commit()
    if claimed is None:
        return {"ran": False}

    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        await redis.enqueue_job("sync_pipeline")
    finally:
        await redis.close()
    log.info("husn.worker.auto_sync.enqueued")
    return {"ran": True}


# Auto-sync cadence is now data-driven (sync_settings), not a fixed cron. The
# per-source backfill / normalize / extract / drift / agent crons are gone:
# ingestion runs ONLY via sync_pipeline — manually (Sync now) or, in automatic
# mode, when auto_sync_tick decides the interval has elapsed.
class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions: list = [
        heartbeat,
        jira_backfill,
        slack_backfill,
        google_backfill,
        microsoft_backfill,
        granola_backfill,
        normalize_graph,
        extract_claims,
        evaluate_drift,
        run_agent,
        sync_pipeline,
        auto_sync_tick,
    ]
    cron_jobs = [
        # The only cron: check the sync setting once a minute and run the
        # pipeline when automatic mode + interval say so. Manual "Sync now"
        # (sync_pipeline via the API) is independent of this.
        cron(auto_sync_tick, second={0}),
    ]
    on_startup = startup
    on_shutdown = shutdown
