"""Granola connect route — API-key paste (no OAuth).

Granola issues a personal API key (`grn_…`) in the desktop app under
Settings → Connectors → API keys (Business plan or higher). The admin pastes
it here; we validate it against the API, store it on a Connection row exactly
like an OAuth bot token, and queue a backfill.
"""

from __future__ import annotations

import hashlib
from typing import Any

import httpx
from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.connectors.granola.client import GranolaClient
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.session import get_session

router = APIRouter(prefix="/auth/granola", tags=["auth"])


class GranolaConnectRequest(BaseModel):
    api_key: str
    label: str | None = None


def _account_id_for(api_key: str) -> str:
    """Stable, non-secret connection id derived from the key, so re-pasting the
    same key updates the same Connection. The raw key is never used in any
    external_id."""
    return "granola-" + hashlib.sha256(api_key.encode()).hexdigest()[:16]


@router.post("/connect")
async def connect(
    body: GranolaConnectRequest,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    api_key = body.api_key.strip()
    if not api_key:
        raise HTTPException(422, "API key is required")

    # Validate the key by making a real (cheap) call. 401/403 → bad key.
    try:
        async with GranolaClient(api_key=api_key) as gc:
            probe = await gc.list_notes()
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(400, "That API key was rejected by Granola. Check the key and its scopes.") from e
        log.warning("husn.granola.connect.probe_failed", status=e.response.status_code)
        raise HTTPException(502, "Couldn't reach Granola to validate the key. Try again.") from e
    except Exception as e:  # noqa: BLE001
        log.warning("husn.granola.connect.probe_error", err=str(e)[:200])
        raise HTTPException(502, "Couldn't reach Granola to validate the key. Try again.") from e

    account_id = _account_id_for(api_key)
    # Best-effort human label from the first note's owner; else a generic one.
    label = body.label
    if not label:
        first = (probe.get("notes") or [{}])[0] or {}
        owner = first.get("owner") or {}
        label = owner.get("name") or owner.get("email") or "Granola"

    stmt = (
        pg_insert(Connection)
        .values(
            tenant_id=ctx.tenant_id,
            source="granola",
            account_id=account_id,
            account_label=label,
            access_token=api_key,
            refresh_token=None,
            token_expires_at=None,  # API keys don't expire
            scopes=None,
            extra={},
        )
        .on_conflict_do_update(
            constraint="uq_connection_tenant_source_account",
            set_={
                "tenant_id": ctx.tenant_id,
                "access_token": api_key,
                "account_label": label,
            },
        )
        .returning(Connection.id)
    )
    result = await session.execute(stmt)
    conn_id = result.scalar_one()
    await session.commit()

    s = get_settings()
    redis = await create_pool(RedisSettings.from_dsn(s.redis_url))
    try:
        await redis.enqueue_job("granola_backfill", conn_id)
    finally:
        await redis.close()

    log.info("husn.granola.connected", connection_id=conn_id, tenant_id=ctx.tenant_id)
    return {"status": "ok", "connection_id": conn_id, "account_label": label}
