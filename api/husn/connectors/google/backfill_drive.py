"""Drive + Docs + Sheets backfill.

Scope: only folders in project_sources(source='google', scope_kind='drive_folder').
Walks each selected folder recursively. For each non-folder file:
  * Doc   → fetch full content via Docs API, store as kind='doc'
  * Sheet → fetch metadata + values via Sheets API, store as kind='sheet'
  * other → store metadata only (PDFs, images, slides), kind='drive_file'

Idempotency: upsert_raw_artifact keyed on external_id. Doc/Sheet content is
re-fetched every run for simplicity — file count is small (Project Atlas
folder is ~20 files). Skip-if-unchanged based on modifiedTime is a future
optimisation.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.client import GoogleClient
from husn.core.logging import log
from husn.db.models import Connection, ProjectSource
from husn.db.upsert import upsert_raw_artifact

DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
DOCS_GET_URL_PATTERN = "https://docs.googleapis.com/v1/documents/{id}"
SHEETS_GET_URL_PATTERN = "https://sheets.googleapis.com/v4/spreadsheets/{id}"

MIME_FOLDER = "application/vnd.google-apps.folder"
MIME_DOC = "application/vnd.google-apps.document"
MIME_SHEET = "application/vnd.google-apps.spreadsheet"

MAX_FILES_PER_FOLDER_PER_RUN = 200  # safety cap; small Project Atlas folder is well under


async def get_allowlist_folders(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(ProjectSource).where(
            ProjectSource.source == "google",
            ProjectSource.scope_kind == "drive_folder",
        )
    )
    return [r.scope_id for r in result.scalars().all()]


async def backfill_drive(session: AsyncSession, connection: Connection) -> dict[str, int]:
    counts = {"folders": 0, "docs": 0, "sheets": 0, "drive_files": 0, "skipped": 0}
    folder_ids = await get_allowlist_folders(session)
    if not folder_ids:
        return counts

    async with GoogleClient(connection=connection, session=session) as gc:
        for root_id in folder_ids:
            counts["folders"] += 1
            await _walk_folder(
                gc, session, connection=connection, folder_id=root_id, counts=counts
            )
            await session.commit()  # commit per-root-folder

    log.info("husn.google.drive.backfill.done", account_id=connection.account_id, **counts)
    return counts


async def _walk_folder(
    gc: GoogleClient,
    session: AsyncSession,
    *,
    connection: Connection,
    folder_id: str,
    counts: dict[str, int],
    depth: int = 0,
    max_depth: int = 8,
) -> None:
    if depth > max_depth:
        log.warning("husn.google.drive.depth_capped", folder_id=folder_id)
        return

    page_token: str | None = None
    processed = 0
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken, files(id, name, mimeType, modifiedTime, owners(emailAddress,displayName), parents, size, webViewLink)",
            "pageSize": 100,
            "orderBy": "modifiedTime desc",
        }
        if page_token:
            params["pageToken"] = page_token
        body = await gc.get(DRIVE_FILES_URL, params=params)
        files = body.get("files", []) or []
        for f in files:
            if processed >= MAX_FILES_PER_FOLDER_PER_RUN:
                log.info("husn.google.drive.cap_hit", folder_id=folder_id)
                return
            await _process_file(
                gc,
                session,
                connection=connection,
                f=f,
                folder_id=folder_id,
                counts=counts,
                depth=depth,
            )
            processed += 1
        page_token = body.get("nextPageToken")
        if not page_token:
            break


async def _process_file(
    gc: GoogleClient,
    session: AsyncSession,
    *,
    connection: Connection,
    f: dict[str, Any],
    folder_id: str,
    counts: dict[str, int],
    depth: int,
) -> None:
    file_id = f.get("id")
    mime = f.get("mimeType") or ""
    if not file_id:
        return

    if mime == MIME_FOLDER:
        # Recurse into subfolder. We still record the folder metadata as a
        # drive_file artifact so the agent can reason about folder structure
        # later if it wants to.
        await upsert_raw_artifact(
            session,
            source="google",
            kind="drive_folder",
            external_id=f"{connection.account_id}:drive_folder:{file_id}",
            payload={**f, "scope_folder_id": folder_id},
            tenant_id=connection.tenant_id,
        )
        await _walk_folder(
            gc, session, connection=connection, folder_id=file_id, counts=counts, depth=depth + 1
        )
        return

    if mime == MIME_DOC:
        try:
            doc = await gc.get(DOCS_GET_URL_PATTERN.format(id=file_id))
        except Exception:
            log.exception("husn.google.docs.get_failed", file_id=file_id)
            counts["skipped"] += 1
            return
        await upsert_raw_artifact(
            session,
            source="google",
            kind="doc",
            external_id=f"{connection.account_id}:doc:{file_id}",
            payload={"drive_metadata": f, "document": doc, "scope_folder_id": folder_id},
            tenant_id=connection.tenant_id,
        )
        counts["docs"] += 1
        return

    if mime == MIME_SHEET:
        try:
            sheet = await gc.get(
                SHEETS_GET_URL_PATTERN.format(id=file_id),
                params={"includeGridData": "true"},
            )
        except Exception:
            log.exception("husn.google.sheets.get_failed", file_id=file_id)
            counts["skipped"] += 1
            return
        await upsert_raw_artifact(
            session,
            source="google",
            kind="sheet",
            external_id=f"{connection.account_id}:sheet:{file_id}",
            payload={"drive_metadata": f, "spreadsheet": sheet, "scope_folder_id": folder_id},
            tenant_id=connection.tenant_id,
        )
        counts["sheets"] += 1
        return

    # Other (PDF, image, slides, etc.) — metadata only
    await upsert_raw_artifact(
        session,
        source="google",
        kind="drive_file",
        external_id=f"{connection.account_id}:drive_file:{file_id}",
        payload={**f, "scope_folder_id": folder_id},
        tenant_id=connection.tenant_id,
    )
    counts["drive_files"] += 1
