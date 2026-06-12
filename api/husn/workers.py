from arq import cron
from arq.connections import RedisSettings

from husn.agent.run_v2 import run_renderer_for_all_projects
from husn.claims.extract import extract_pending as claims_extract_pending
from husn.connectors.google.backfill import backfill_connection as google_backfill_connection
from husn.connectors.google.backfill import get_connections as google_get_connections
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
    """Step 6 agent — runs LLM analysis over each project. Cron every 5 min.

    NOT run_at_startup: a single run can take ~30s on Ollama with a real
    dossier, and we don't want it blocking the worker's normal boot. The
    first cron tick within ~5 min will pick it up.
    """
    async with SessionLocal() as session:
        return await run_renderer_for_all_projects(session, trigger="cron")


# Cron schedules — drift-tolerant offsets so the jobs don't pile up.
_BACKFILL_JIRA_SECONDS = {0}             # :00 — jira backfill
_BACKFILL_GOOGLE_SECONDS = {15}          # :15 — google (Gmail + Drive)
_BACKFILL_SLACK_SECONDS = {30}           # :30 — slack backfill
_BACKFILL_MS_SECONDS = {45}              # :45 — microsoft (Outlook + OneDrive)
_NORMALIZE_SECONDS = {0, 15, 30, 45}     # every 15s
_EXTRACT_SECONDS = {5, 20, 35, 50}       # 5s after normalize
_DRIFT_SECONDS = {10, 40}                # 5s after extract, twice/min
_AGENT_MINUTES = {0, 30}  # every 30 min — Groq's daily token cap on llama-3.3-70b
                          # gets shredded by a 5-min cadence on a non-empty graph.
                          # Manual "Sync now" still works for on-demand refresh.


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions: list = [
        heartbeat,
        jira_backfill,
        slack_backfill,
        google_backfill,
        microsoft_backfill,
        normalize_graph,
        extract_claims,
        evaluate_drift,
        run_agent,
    ]
    cron_jobs = [
        cron(jira_backfill, second=_BACKFILL_JIRA_SECONDS, run_at_startup=True),
        cron(google_backfill, second=_BACKFILL_GOOGLE_SECONDS, run_at_startup=True),
        cron(slack_backfill, second=_BACKFILL_SLACK_SECONDS, run_at_startup=True),
        cron(microsoft_backfill, second=_BACKFILL_MS_SECONDS, run_at_startup=True),
        cron(normalize_graph, second=_NORMALIZE_SECONDS, run_at_startup=True),
        cron(extract_claims, second=_EXTRACT_SECONDS, run_at_startup=True),
        cron(evaluate_drift, second=_DRIFT_SECONDS, run_at_startup=True),
        # Agent on a 5-min cadence; second=0 so the cost is borne at the top of each window.
        cron(run_agent, minute=_AGENT_MINUTES, second={0}),
    ]
    on_startup = startup
    on_shutdown = shutdown
