"""Microsoft admin endpoints — list mail folders, list OneDrive subfolders, CRUD on allowlist."""

from typing import Any

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.auth.scope import tenant_where
from husn.connectors.microsoft.client import MicrosoftClient
from husn.connectors.microsoft.listing import (
    get_onedrive_folder_metadata,
    list_mail_folders,
    list_onedrive_folders,
)
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Connection, ProjectSource
from husn.db.session import get_session
from husn.graph.projects import get_or_create_default_project

router = APIRouter(prefix="/api/microsoft", tags=["microsoft"])

OUTLOOK_FOLDER_SCOPE = "outlook_folder"
ONEDRIVE_FOLDER_SCOPE = "onedrive_folder"


async def _current_connection(session: AsyncSession, ctx: AuthContext) -> Connection:
    result = await session.execute(
        tenant_where(
            select(Connection)
            .where(Connection.source == "microsoft")
            .order_by(Connection.id.desc()),
            Connection,
            ctx,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "No Microsoft connection — connect via /auth/microsoft/start first.")
    return conn


@router.get("/mail-folders")
async def get_mail_folders(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    conn = await _current_connection(session, ctx)
    async with MicrosoftClient(connection=conn, session=session) as mc:
        folders = await list_mail_folders(mc)
    return {
        "count": len(folders),
        "items": [
            {
                "id": f.get("id"),
                "name": f.get("displayName"),
                "total": f.get("totalItemCount"),
                "unread": f.get("unreadItemCount"),
                "child_folder_count": f.get("childFolderCount"),
            }
            for f in folders
        ],
    }


@router.get("/folders")
async def get_onedrive_folders(
    parent_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    """OneDrive subfolders of `parent_id`. None = root of My Drive."""
    conn = await _current_connection(session, ctx)
    async with MicrosoftClient(connection=conn, session=session) as mc:
        body = await list_onedrive_folders(mc, parent_id=parent_id)
    out_folders: list[dict[str, Any]] = []
    for f in body["folders"]:
        # If this is a remoteItem-folder (a shared/mounted org folder like
        # "Project Atlas" added to My files, or Personal Vault), serve the
        # encoded scope id so subsequent /folders?parent_id=... calls and the
        # eventual scope_id stored in project_sources resolve to the right
        # drive. Plain user-drive folders keep their plain id.
        remote_drive_id = f.get("_remote_drive_id")
        remote_item_id = f.get("_remote_item_id")
        if remote_drive_id and remote_item_id:
            scope_id = f"remote:{remote_drive_id}:{remote_item_id}"
        else:
            scope_id = f.get("id")
        out_folders.append(
            {
                "id": scope_id,
                "name": f.get("name"),
                "is_remote": bool(remote_drive_id),
                "modified_time": f.get("lastModifiedDateTime"),
                "web_url": f.get("webUrl"),
                "owners": [
                    (f.get("createdBy") or {}).get("user", {}).get("displayName")
                    or (f.get("createdBy") or {}).get("user", {}).get("email")
                ]
                if f.get("createdBy")
                else [],
            }
        )
    return {
        "parent_id": parent_id,
        "file_count": body["file_count"],
        "folders": out_folders,
    }


@router.get("/folders/{folder_id}/metadata")
async def folder_metadata(
    folder_id: str,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    conn = await _current_connection(session, ctx)
    async with MicrosoftClient(connection=conn, session=session) as mc:
        try:
            meta = await get_onedrive_folder_metadata(mc, folder_id)
        except Exception:
            return {"id": folder_id, "name": "(inaccessible)"}
    return {
        "id": meta.get("id"),
        "name": meta.get("name"),
        "web_url": meta.get("webUrl"),
    }


@router.get("/allowlist")
async def get_allowlist(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    project = await get_or_create_default_project(session, tenant_id=ctx.tenant_id)
    result = await session.execute(
        select(ProjectSource).where(
            ProjectSource.project_id == project.id,
            ProjectSource.source == "microsoft",
        )
    )
    rows = result.scalars().all()
    return {
        "project_id": project.id,
        "outlook_folders": [r.scope_id for r in rows if r.scope_kind == OUTLOOK_FOLDER_SCOPE],
        "onedrive_folders": [r.scope_id for r in rows if r.scope_kind == ONEDRIVE_FOLDER_SCOPE],
    }


class AllowlistBody(BaseModel):
    outlook_folders: list[str] = []
    onedrive_folders: list[str] = []


@router.post("/allowlist")
async def set_allowlist(
    body: AllowlistBody,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    project = await get_or_create_default_project(session, tenant_id=ctx.tenant_id)
    await session.execute(
        delete(ProjectSource).where(
            ProjectSource.project_id == project.id,
            ProjectSource.source == "microsoft",
        )
    )
    for fid in body.outlook_folders:
        if not fid:
            continue
        await session.execute(
            pg_insert(ProjectSource)
            .values(
                project_id=project.id,
                source="microsoft",
                scope_kind=OUTLOOK_FOLDER_SCOPE,
                scope_id=fid,
            )
            .on_conflict_do_nothing(constraint="uq_project_source_scope")
        )
    for fid in body.onedrive_folders:
        if not fid:
            continue
        await session.execute(
            pg_insert(ProjectSource)
            .values(
                project_id=project.id,
                source="microsoft",
                scope_kind=ONEDRIVE_FOLDER_SCOPE,
                scope_id=fid,
            )
            .on_conflict_do_nothing(constraint="uq_project_source_scope")
        )
    await session.commit()
    log.info(
        "husn.microsoft.allowlist.saved",
        project_id=project.id,
        outlook_folders=len(body.outlook_folders),
        onedrive_folders=len(body.onedrive_folders),
    )

    # Auto-enqueue backfill (will be a no-op until the worker task is registered)
    queued: str | None = None
    try:
        redis = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
        try:
            job = await redis.enqueue_job("microsoft_backfill")
            queued = job.job_id if job else None
        finally:
            await redis.aclose()
    except Exception:
        log.info("husn.microsoft.allowlist.backfill_enqueue_skipped")

    return {
        "project_id": project.id,
        "outlook_folders": body.outlook_folders,
        "onedrive_folders": body.onedrive_folders,
        "backfill_job_id": queued,
    }
