"""Slack admin endpoints — trigger backfill."""

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.auth.scope import tenant_where
from husn.core.config import get_settings
from husn.db.models import Connection
from husn.db.session import get_session

router = APIRouter(prefix="/slack", tags=["slack"])


@router.post("/backfill")
async def trigger_backfill(
    connection_id: int | None = None,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict:
    if connection_id is not None:
        result = await session.execute(
            tenant_where(
                select(Connection).where(
                    Connection.id == connection_id, Connection.source == "slack"
                ),
                Connection,
                ctx,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(404, f"slack connection {connection_id} not found")
    redis = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    try:
        job = await redis.enqueue_job("slack_backfill", connection_id)
    finally:
        await redis.close()
    return {"queued": True, "job_id": job.job_id if job else None, "connection_id": connection_id}
