"""Agent admin endpoints — run on demand, list briefs, list runs."""

from typing import Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.agent.run_v2 import run_renderer_for_project
from husn.auth.deps import AuthContext, require_admin, require_member
from husn.auth.scope import tenant_where
from husn.core.config import get_settings
from husn.db.models import AgentRun, Brief, Project
from husn.db.session import get_session

router = APIRouter(prefix="/api/agent", tags=["agent"])
sync_router = APIRouter(prefix="/api/sync", tags=["sync"])


@sync_router.post("/now")
async def sync_now(
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    """One-click 'Sync now' — fan out backfills for every source, then chain
    normalize → extract → drift → render. The cron crons exist for steady
    state; this is the manual refresh button for the briefing.

    All jobs are async; we return immediately with the queued job ids.
    """
    redis = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    queued: dict[str, str | None] = {}
    try:
        for job_name in (
            "jira_backfill",
            "slack_backfill",
            "google_backfill",
            "microsoft_backfill",
            "normalize_graph",
            "extract_claims",
            "evaluate_drift",
            "run_agent",
        ):
            job = await redis.enqueue_job(job_name)
            queued[job_name] = job.job_id if job else None
    finally:
        await redis.aclose()
    return {"queued": True, "jobs": queued}


@router.get("/status")
async def status(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Latest agent_run per project + global last-run timestamp."""
    s = get_settings()
    last_run = (
        await session.execute(tenant_where(select(func.max(AgentRun.started_at)), AgentRun, ctx))
    ).scalar()
    last_ok = (
        await session.execute(
            tenant_where(
                select(func.max(AgentRun.finished_at)).where(AgentRun.status == "ok"),
                AgentRun,
                ctx,
            )
        )
    ).scalar()
    total_runs = (
        await session.execute(tenant_where(select(func.count(AgentRun.id)), AgentRun, ctx))
    ).scalar_one()
    total_briefs = (
        await session.execute(tenant_where(select(func.count(Brief.id)), Brief, ctx))
    ).scalar_one()

    in_progress = (
        await session.execute(
            tenant_where(
                select(func.count(AgentRun.id)).where(AgentRun.status == "running"),
                AgentRun,
                ctx,
            )
        )
    ).scalar_one()

    return {
        "provider": s.llm_provider,
        "model": _model_for(s),
        "last_run_at": last_run.isoformat() if last_run else None,
        "last_ok_at": last_ok.isoformat() if last_ok else None,
        "total_runs": total_runs,
        "total_briefs": total_briefs,
        "in_progress": in_progress,
    }


@router.post("/run")
async def trigger_run(
    project_id: int | None = Query(None, description="Project id; omit for all projects"),
    async_mode: bool = Query(True, description="True: enqueue + return immediately"),
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    """Trigger an agent run. By default async — queues the job and returns.
    For testing, pass async_mode=false to run inline (will block until done).
    """
    if project_id is not None:
        project = await session.get(Project, project_id)
        if not project or (
            ctx.tenant_id is not None and project.tenant_id != ctx.tenant_id
        ):
            raise HTTPException(404, f"project {project_id} not found")

    if async_mode:
        redis = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
        try:
            if project_id is not None:
                # We don't have a per-project task fn; the cron version runs
                # all projects. Enqueue that — fine for current single-project state.
                job = await redis.enqueue_job("run_agent")
            else:
                job = await redis.enqueue_job("run_agent")
        finally:
            await redis.aclose()
        return {"queued": True, "job_id": job.job_id if job else None}

    if project_id is None:
        # Run for the first project (default "All work") synchronously
        first = (
            await session.execute(
                tenant_where(select(Project).order_by(Project.id), Project, ctx)
            )
        ).scalars().first()
        if first is None:
            raise HTTPException(400, "no projects defined")
        project_id = first.id
    result = await run_renderer_for_project(session, project_id=project_id, trigger="manual")
    return result


@router.get("/runs")
async def list_runs(
    limit: int = Query(20, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    rows = (
        await session.execute(
            tenant_where(
                select(AgentRun).order_by(desc(AgentRun.started_at)).limit(limit),
                AgentRun,
                ctx,
            )
        )
    ).scalars().all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": r.id,
                "project_id": r.project_id,
                "trigger": r.trigger,
                "status": r.status,
                "provider": r.provider,
                "model": r.model,
                "started_at": r.started_at.isoformat(),
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "duration_ms": r.duration_ms,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "finding_count": r.finding_count,
                "brief_count": r.brief_count,
                "error": r.error,
            }
            for r in rows
        ],
    }


@router.get("/briefs")
async def list_briefs(
    project_id: int | None = Query(None),
    persona: str | None = Query(None),
    limit: int = Query(20, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    stmt = tenant_where(select(Brief).order_by(desc(Brief.generated_at)).limit(limit), Brief, ctx)
    if project_id is not None:
        stmt = stmt.where(Brief.project_id == project_id)
    if persona:
        stmt = stmt.where(Brief.persona == persona)
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": b.id,
                "project_id": b.project_id,
                "persona": b.persona,
                "agent_run_id": b.agent_run_id,
                "model": b.model,
                "generated_at": b.generated_at.isoformat(),
                "content": b.content,
                "source_claim_ids": b.source_claim_ids,
            }
            for b in rows
        ],
    }


def _model_for(s) -> str:
    if s.llm_provider == "ollama":
        return s.ollama_model
    if s.llm_provider == "groq":
        return s.groq_model
    if s.llm_provider == "anthropic":
        return s.anthropic_model
    return "?"
