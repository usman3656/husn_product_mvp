"""Connection management — list/inspect/disconnect across all sources.

This is the page you visit in production to revoke access, re-authorize an
expired refresh token, or see "last sync N minutes ago" per source.
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin, require_member
from husn.auth.scope import tenant_where
from husn.core.logging import log
from husn.db.models import (
    Artifact,
    Connection,
    Project,
    ProjectSource,
    RawArtifact,
)
from husn.db.session import get_session
from husn.graph.emoji import demojize_slack

router = APIRouter(prefix="/api/connections", tags=["connections"])


@router.get("")
async def list_connections(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """All connections across all sources, with health + sync metrics."""
    conns = (
        await session.execute(
            tenant_where(select(Connection).order_by(Connection.id), Connection, ctx)
        )
    ).scalars().all()

    out = []
    now = datetime.now(UTC)
    for c in conns:
        last_raw = (
            await session.execute(
                tenant_where(
                    select(func.max(RawArtifact.fetched_at)).where(
                        RawArtifact.source == c.source
                    ),
                    RawArtifact,
                    ctx,
                )
            )
        ).scalar()
        raw_count = (
            await session.execute(
                tenant_where(
                    select(func.count(RawArtifact.id)).where(RawArtifact.source == c.source),
                    RawArtifact,
                    ctx,
                )
            )
        ).scalar_one()
        artifact_count = (
            await session.execute(
                tenant_where(
                    select(func.count(Artifact.id)).where(Artifact.source == c.source),
                    Artifact,
                    ctx,
                )
            )
        ).scalar_one()
        # ProjectSource has no tenant_id — derive via the owning Project.
        scope_q = select(func.count(ProjectSource.id)).where(ProjectSource.source == c.source)
        if ctx.tenant_id is not None:
            scope_q = scope_q.join(Project, Project.id == ProjectSource.project_id).where(
                Project.tenant_id == ctx.tenant_id
            )
        scope_count = (await session.execute(scope_q)).scalar_one()

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
    connection_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
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
    if not conn or (ctx.tenant_id is not None and conn.tenant_id != ctx.tenant_id):
        raise HTTPException(404, f"connection {connection_id} not found")

    # Remove the per-source allowlist rows for this source.
    # ProjectSource has no tenant_id — when scoped, restrict to the tenant's
    # projects so a disconnect never wipes another tenant's allowlist.
    ps_delete = delete(ProjectSource).where(ProjectSource.source == conn.source)
    if ctx.tenant_id is not None:
        ps_delete = ps_delete.where(
            ProjectSource.project_id.in_(
                select(Project.id).where(Project.tenant_id == ctx.tenant_id)
            )
        )
    await session.execute(ps_delete)
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
    connection_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    """Drop delta cursors / history tokens so the next backfill is full-scan.

    Idempotent. Does not touch tokens, allowlist, or historical artifacts.
    Use when a fresh re-auth left a sync stuck in delta-mode-with-no-changes,
    or after the founder forces a recovery from a known-good state.
    """
    conn = await session.get(Connection, connection_id)
    if not conn or (ctx.tenant_id is not None and conn.tenant_id != ctx.tenant_id):
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


# Humanized fallback labels per (source, kind) when there's no title/body to
# show — anything but the raw external id (``T…:message:C…:1781552448.5``).
_KIND_LABELS = {
    ("slack", "message"): "Slack message",
    ("slack", "channel"): "Slack channel",
    ("slack", "user"): "Slack profile",
    ("jira", "issue"): "Jira issue",
    ("google", "gmail"): "Email",
    ("microsoft", "outlook"): "Email",
}


def _file_label(r: Any, source: str) -> str:
    """Human-readable label for a connection's file row.

    Prefers the normalized Artifact.title; for older Slack messages whose title
    predates the normalizer change it reconstructs ``#channel: text…`` from
    body/extra; otherwise a "<Source> <kind>" label. Never the raw external id.
    """
    title = getattr(r, "title", None)
    if title:
        return title
    body = getattr(r, "body", None)
    extra = getattr(r, "extra", None) or {}
    if body or extra.get("channel_name"):
        chan = extra.get("channel_name")
        snippet = " ".join((demojize_slack(body) or "").split())
        if len(snippet) > 80:
            snippet = snippet[:79].rstrip() + "…"
        chan_label = f"#{chan}" if chan else None
        if chan_label and snippet:
            return f"{chan_label}: {snippet}"
        if chan_label or snippet:
            return chan_label or snippet
    labelled = _KIND_LABELS.get((source, r.kind))
    if labelled:
        return labelled
    if r.kind:
        return f"{source.title()} {r.kind.replace('_', ' ')}".strip()
    return r.external_id


@router.get("/{connection_id}/files")
async def list_connection_files(
    connection_id: int,
    limit: int = Query(80, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Files (RawArtifacts) read from this connection's source, with read
    status per file.

    Read status:
      * "read"     — raw record + normalized Artifact both present
      * "fetched"  — raw record present, not yet normalized
      * (we never persist a row for a fetch that failed, so "failed" is
        not a status the API can report — connector logs are the source
        of truth for fetch failures.)

    Returns most-recent first, capped at `limit`.
    """
    conn = await session.get(Connection, connection_id)
    if not conn or (ctx.tenant_id is not None and conn.tenant_id != ctx.tenant_id):
        raise HTTPException(404, f"connection {connection_id} not found")

    stmt = (
        select(
            RawArtifact.id,
            RawArtifact.kind,
            RawArtifact.external_id,
            RawArtifact.fetched_at,
            Artifact.id.label("artifact_id"),
            Artifact.title,
            Artifact.body,
            Artifact.extra,
            Artifact.url,
            Artifact.normalized_at,
            Artifact.status,
        )
        .select_from(RawArtifact)
        .outerjoin(Artifact, Artifact.raw_artifact_id == RawArtifact.id)
        .where(RawArtifact.source == conn.source)
        .order_by(desc(RawArtifact.fetched_at))
        .limit(limit)
    )
    stmt = tenant_where(stmt, RawArtifact, ctx)
    rows = (await session.execute(stmt)).all()

    total_raw = (
        await session.execute(
            tenant_where(
                select(func.count(RawArtifact.id)).where(RawArtifact.source == conn.source),
                RawArtifact,
                ctx,
            )
        )
    ).scalar_one()
    total_artifacts = (
        await session.execute(
            tenant_where(
                select(func.count(Artifact.id)).where(Artifact.source == conn.source),
                Artifact,
                ctx,
            )
        )
    ).scalar_one()

    items = [
        {
            "raw_id": r.id,
            "kind": r.kind,
            "external_id": r.external_id,
            "title": _file_label(r, conn.source),
            "url": r.url,
            "fetched_at": r.fetched_at.isoformat() if r.fetched_at else None,
            "normalized_at": r.normalized_at.isoformat() if r.normalized_at else None,
            "status_label": "read" if r.artifact_id is not None else "fetched",
            "source_status": r.status,
        }
        for r in rows
    ]

    return {
        "connection_id": conn.id,
        "source": conn.source,
        "account_label": conn.account_label,
        "totals": {
            "fetched": total_raw,
            "read": total_artifacts,
            "pending": max(0, total_raw - total_artifacts),
        },
        "items": items,
        "showing": len(items),
    }


@router.post("/reset-sync-all")
async def reset_sync_all(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    """Bulk: clear cursors on every connection. Same semantics as the
    per-connection endpoint, applied to all rows in one transaction.
    """
    conns = (
        await session.execute(tenant_where(select(Connection), Connection, ctx))
    ).scalars().all()
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
