"""Google admin endpoints — labels list, folders list, allowlist CRUD.

The allowlist is persisted as project_sources rows with:
  source="google", scope_kind in {"gmail_label", "drive_folder"},
  scope_id = label_id (e.g. "Label_123") or folder_id (e.g. "1abc...").
The project_id is the default 'All work' project — Step 2 user-curated split
into multiple projects lands later.
"""

from typing import Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.client import GoogleClient
from husn.connectors.google.listing import (
    get_folder_metadata,
    list_folder_children,
    list_labels,
    list_root_folders,
)
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Connection, ProjectSource
from husn.db.session import get_session
from husn.graph.projects import get_or_create_default_project

router = APIRouter(prefix="/api/google", tags=["google"])


GMAIL_LABEL_SCOPE = "gmail_label"
DRIVE_FOLDER_SCOPE = "drive_folder"


async def _current_connection(session: AsyncSession) -> Connection:
    result = await session.execute(
        select(Connection).where(Connection.source == "google").order_by(Connection.id.desc())
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "No Google connection — connect via /auth/google/start first.")
    return conn


@router.get("/labels")
async def get_labels(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Gmail labels for the picker."""
    conn = await _current_connection(session)
    async with GoogleClient(connection=conn, session=session) as gc:
        labels = await list_labels(gc)
    return {
        "count": len(labels),
        "items": [
            {
                "id": l.get("id"),
                "name": l.get("name"),
                "type": l.get("type"),  # "system" | "user"
                "messages_total": l.get("messagesTotal"),
                "messages_unread": l.get("messagesUnread"),
            }
            for l in labels
        ],
    }


@router.get("/folders")
async def get_folders(
    parent_id: str = "root",
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Drive subfolders of `parent_id`. `parent_id='root'` = My Drive root.

    The tree picker calls this on every expand to lazy-load children.
    Also returns the count of direct child files so the UI shows
    `📁 X (12 files)` for each folder.
    """
    conn = await _current_connection(session)
    async with GoogleClient(connection=conn, session=session) as gc:
        body = await list_folder_children(gc, parent_id=parent_id)
    return {
        "parent_id": parent_id,
        "file_count": body["file_count"],
        "folders": [
            {
                "id": f.get("id"),
                "name": f.get("name"),
                "modified_time": f.get("modifiedTime"),
                "owners": [
                    o.get("displayName") or o.get("emailAddress")
                    for o in (f.get("owners") or [])
                ],
            }
            for f in body["folders"]
        ],
    }


@router.get("/folders/{folder_id}/metadata")
async def get_folder_meta(
    folder_id: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """Resolve a stored folder id back to name (used for rendering already-selected items in the tree)."""
    conn = await _current_connection(session)
    async with GoogleClient(connection=conn, session=session) as gc:
        try:
            meta = await get_folder_metadata(gc, folder_id)
        except Exception:
            return {"id": folder_id, "name": "(inaccessible)", "owners": []}
    return {
        "id": meta.get("id"),
        "name": meta.get("name"),
        "owners": [
            o.get("displayName") or o.get("emailAddress")
            for o in (meta.get("owners") or [])
        ],
    }


@router.get("/allowlist")
async def get_allowlist(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    project = await get_or_create_default_project(session)
    result = await session.execute(
        select(ProjectSource).where(
            ProjectSource.project_id == project.id,
            ProjectSource.source == "google",
        )
    )
    rows = result.scalars().all()
    return {
        "project_id": project.id,
        "labels": [r.scope_id for r in rows if r.scope_kind == GMAIL_LABEL_SCOPE],
        "folders": [r.scope_id for r in rows if r.scope_kind == DRIVE_FOLDER_SCOPE],
    }


class AllowlistBody(BaseModel):
    labels: list[str] = []  # Gmail label IDs
    folders: list[str] = []  # Drive folder IDs


@router.post("/allowlist")
async def set_allowlist(
    body: AllowlistBody,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Replace the Google allowlist for the default project. Idempotent:
    re-running with the same body yields the same project_sources rows.
    """
    project = await get_or_create_default_project(session)

    # Wipe existing google rows (cheap — there are at most ~6 of them)
    await session.execute(
        delete(ProjectSource).where(
            ProjectSource.project_id == project.id,
            ProjectSource.source == "google",
        )
    )

    for label_id in body.labels:
        if not label_id:
            continue
        await session.execute(
            pg_insert(ProjectSource)
            .values(
                project_id=project.id,
                source="google",
                scope_kind=GMAIL_LABEL_SCOPE,
                scope_id=label_id,
            )
            .on_conflict_do_nothing(constraint="uq_project_source_scope")
        )
    for folder_id in body.folders:
        if not folder_id:
            continue
        await session.execute(
            pg_insert(ProjectSource)
            .values(
                project_id=project.id,
                source="google",
                scope_kind=DRIVE_FOLDER_SCOPE,
                scope_id=folder_id,
            )
            .on_conflict_do_nothing(constraint="uq_project_source_scope")
        )
    await session.commit()
    log.info(
        "husn.google.allowlist.saved",
        project_id=project.id,
        labels=len(body.labels),
        folders=len(body.folders),
    )

    # Auto-enqueue backfill if available. The backfill function isn't
    # registered yet (task 53) — soft-skip the enqueue when it's missing
    # so this endpoint stays useful even before backfill lands.
    queued: str | None = None
    try:
        redis = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
        try:
            job = await redis.enqueue_job("google_backfill")
            queued = job.job_id if job else None
        finally:
            await redis.aclose()
    except Exception:
        log.info("husn.google.allowlist.backfill_enqueue_skipped")

    return {
        "project_id": project.id,
        "labels": body.labels,
        "folders": body.folders,
        "backfill_job_id": queued,
    }
