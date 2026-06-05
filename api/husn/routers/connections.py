"""Connection management — list/inspect/disconnect across all sources.

This is the page you visit in production to revoke access, re-authorize an
expired refresh token, or see "last sync N minutes ago" per source.
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.core.logging import log
from husn.db.models import (
    Artifact,
    Connection,
    ProjectSource,
    RawArtifact,
)
from husn.db.session import get_session

router = APIRouter(prefix="/api/connections", tags=["connections"])


@router.get("")
async def list_connections(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """All connections across all sources, with health + sync metrics."""
    conns = (await session.execute(select(Connection).order_by(Connection.id))).scalars().all()

    out = []
    now = datetime.now(UTC)
    for c in conns:
        last_raw = (
            await session.execute(
                select(func.max(RawArtifact.fetched_at)).where(
                    RawArtifact.source == c.source
                )
            )
        ).scalar()
        raw_count = (
            await session.execute(
                select(func.count(RawArtifact.id)).where(RawArtifact.source == c.source)
            )
        ).scalar_one()
        artifact_count = (
            await session.execute(
                select(func.count(Artifact.id)).where(Artifact.source == c.source)
            )
        ).scalar_one()
        scope_count = (
            await session.execute(
                select(func.count(ProjectSource.id)).where(ProjectSource.source == c.source)
            )
        ).scalar_one()

        token_status = "ok"
        seconds_until_expiry: int | None = None
        if c.token_expires_at:
            delta = (c.token_expires_at - now).total_seconds()
            seconds_until_expiry = int(delta)
            if delta < 0:
                token_status = "expired" if c.refresh_token else "expired-no-refresh"
            elif delta < 300:
                token_status = "expiring-soon"

        out.append(
            {
                "id": c.id,
                "source": c.source,
                "account_id": c.account_id,
                "account_label": c.account_label,
                "scopes": c.scopes,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
                "token_expires_at": c.token_expires_at.isoformat() if c.token_expires_at else None,
                "token_status": token_status,
                "seconds_until_expiry": seconds_until_expiry,
                "has_refresh_token": bool(c.refresh_token),
                "last_raw_fetched_at": last_raw.isoformat() if last_raw else None,
                "raw_artifact_count": raw_count,
                "artifact_count": artifact_count,
                "scope_count": scope_count,
            }
        )
    return {"count": len(out), "items": out}


@router.delete("/{connection_id}")
async def disconnect(
    connection_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """Remove a connection + its project_sources rows. Raw artifacts/
    artifacts/claims are kept (so historical analysis isn't lost) but new
    syncs stop because the token + allowlist are gone.

    Note: this does NOT call the provider's token-revoke endpoint. For
    full revocation, the user should also visit:
      Slack  → workspace settings → Apps Installed → Uninstall
      Atlassian → User profile → Connected apps
      Google → myaccount.google.com → Security → Third-party apps
    """
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(404, f"connection {connection_id} not found")

    # Remove the per-source allowlist rows for this source
    await session.execute(
        delete(ProjectSource).where(ProjectSource.source == conn.source)
    )
    await session.delete(conn)
    await session.commit()
    log.info("husn.connections.disconnect", source=conn.source, account_id=conn.account_id)
    return {"removed": True, "source": conn.source, "account_id": conn.account_id}


# ---------- Sync cursor reset ------------------------------------------------
#
# Cursors live on `connection.extra` as a JSONB dict. Per source the keys are:
#   google     -> gmail_history_id, drive_start_page_token, drive_changes_page_token
#   microsoft  -> drive_deltas (dict), outlook_deltas (dict), drive_delta_link (legacy)
#   jira       -> (none; full-scan each tick)
#   slack      -> (none; full-scan each tick)
#
# After disconnect + reconnect the new Connection row may inherit an
# extra blob from the auth-callback merge logic; or it may be fresh but the
# code's delta-mode branch still returns no items because the provider's
# delta link from the old token chain doesn't surface anything new on the
# fresh token. Cheapest fix: blow away the cursor keys; next backfill tick
# falls into the full-listing branch and re-pulls everything.

_CURSOR_KEYS_TO_DROP = {
    # google
    "gmail_history_id",
    "drive_start_page_token",
    "drive_changes_page_token",
    # microsoft
    "drive_deltas",
    "outlook_deltas",
    "drive_delta_link",
}


def _drop_cursor_keys(extra: dict[str, Any] | None) -> tuple[dict[str, Any], list[str]]:
    extra = dict(extra or {})
    dropped: list[str] = []
    for key in list(extra.keys()):
        if key in _CURSOR_KEYS_TO_DROP:
            dropped.append(key)
            extra.pop(key, None)
    return extra, dropped


@router.post("/{connection_id}/reset-sync")
async def reset_sync(
    connection_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """Drop delta cursors / history tokens so the next backfill is full-scan.

    Idempotent. Does not touch tokens, allowlist, or historical artifacts.
    Use when a fresh re-auth left a sync stuck in delta-mode-with-no-changes,
    or after the founder forces a recovery from a known-good state.
    """
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(404, f"connection {connection_id} not found")
    new_extra, dropped = _drop_cursor_keys(conn.extra)
    conn.extra = new_extra
    await session.commit()
    log.info(
        "husn.connections.reset_sync",
        source=conn.source,
        account_id=conn.account_id,
        connection_id=conn.id,
        dropped=dropped,
    )
    return {
        "reset": True,
        "source": conn.source,
        "connection_id": conn.id,
        "dropped_keys": dropped,
    }


@router.post("/reset-sync-all")
async def reset_sync_all(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Bulk: clear cursors on every connection. Same semantics as the
    per-connection endpoint, applied to all rows in one transaction.
    """
    conns = (await session.execute(select(Connection))).scalars().all()
    summary: list[dict[str, Any]] = []
    for c in conns:
        new_extra, dropped = _drop_cursor_keys(c.extra)
        c.extra = new_extra
        summary.append(
            {
                "connection_id": c.id,
                "source": c.source,
                "dropped_keys": dropped,
            }
        )
    await session.commit()
    log.info("husn.connections.reset_sync_all", connections=len(conns))
    return {"reset": True, "count": len(conns), "items": summary}
