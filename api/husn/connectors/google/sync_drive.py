"""Drive incremental sync using the changes API.

First run (no cursor stored on Connection):
  1. Initialize cursor via `changes.getStartPageToken`
  2. Run a full backfill of the allowlisted folders (existing backfill_drive code)
  3. Persist the cursor

Subsequent runs:
  1. Read cursor from connection.extra.drive_page_token
  2. Call `changes.list?pageToken=<cursor>` — returns ONLY files that changed
  3. For each change, decide if it's in our scope:
     a) we've ingested it before → it's in scope, re-fetch content
     b) we haven't → check the file's parent against allowlisted folder set;
        if any ancestor (up to 3 levels) is allowlisted, ingest
  4. Persist the new cursor

Cursor invalidation: if Drive returns 400/404 on the cursor (too old),
fall back to a full backfill which re-initializes the cursor.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.backfill_drive import (
    DOCS_GET_URL_PATTERN,
    DRIVE_FILES_URL,
    MIME_DOC,
    MIME_FOLDER,
    MIME_SHEET,
    SHEETS_GET_URL_PATTERN,
    backfill_drive,
    get_allowlist_folders,
)
from husn.connectors.google.client import GoogleClient
from husn.core.logging import log
from husn.db.models import Connection, RawArtifact
from husn.db.upsert import upsert_raw_artifact

DRIVE_START_PAGE_TOKEN_URL = "https://www.googleapis.com/drive/v3/changes/startPageToken"
DRIVE_CHANGES_URL = "https://www.googleapis.com/drive/v3/changes"
MAX_PARENT_WALK_DEPTH = 4


async def sync_drive(session: AsyncSession, connection: Connection) -> dict[str, int]:
    """Delta-only sync. Falls back to full backfill on first run / invalidated cursor."""
    extra = dict(connection.extra or {})
    cursor = extra.get("drive_page_token")
    allowlist = set(await get_allowlist_folders(session))
    if not allowlist:
        return {"skipped": 1}

    if not cursor:
        # First time. Capture the cursor BEFORE backfilling so we don't lose
        # changes that happen during backfill.
        async with GoogleClient(connection=connection, session=session) as gc:
            token_body = await gc.get(DRIVE_START_PAGE_TOKEN_URL)
        new_token = token_body.get("startPageToken")
        log.info(
            "husn.google.drive.cursor.init",
            account_id=connection.account_id,
            cursor=new_token,
        )
        counts = await backfill_drive(session, connection)
        # Persist cursor on the (refreshed) connection
        extra["drive_page_token"] = new_token
        connection.extra = extra
        await session.commit()
        return {**counts, "mode": "initial_backfill"}

    counts = {"changes_returned": 0, "docs": 0, "sheets": 0, "drive_files": 0, "skipped": 0}
    async with GoogleClient(connection=connection, session=session) as gc:
        page_token: str | None = cursor
        new_start_token: str | None = None
        while True:
            try:
                body = await gc.get(
                    DRIVE_CHANGES_URL,
                    params={
                        "pageToken": page_token,
                        "fields": (
                            "newStartPageToken, nextPageToken, "
                            "changes(fileId, removed, time, file("
                            "id, name, mimeType, modifiedTime, parents, "
                            "owners(emailAddress,displayName), size, webViewLink, trashed"
                            "))"
                        ),
                        "pageSize": 100,
                        "includeRemoved": "true",
                    },
                )
            except Exception:
                # Likely an invalidated cursor. Reset and let next run do a full backfill.
                log.exception("husn.google.drive.changes.failed; resetting cursor")
                extra["drive_page_token"] = None
                connection.extra = extra
                await session.commit()
                return {"reset": True, **counts}

            changes = body.get("changes", []) or []
            counts["changes_returned"] += len(changes)
            for ch in changes:
                await _process_change(
                    gc, session, connection=connection, change=ch, allowlist=allowlist, counts=counts
                )
            new_start_token = body.get("newStartPageToken")
            page_token = body.get("nextPageToken")
            if not page_token:
                break

        if new_start_token:
            extra["drive_page_token"] = new_start_token
            connection.extra = extra

    await session.commit()
    if counts["changes_returned"]:
        log.info("husn.google.drive.sync", account_id=connection.account_id, **counts)
    return {**counts, "mode": "delta"}


async def _process_change(
    gc: GoogleClient,
    session: AsyncSession,
    *,
    connection: Connection,
    change: dict[str, Any],
    allowlist: set[str],
    counts: dict[str, int],
) -> None:
    file = change.get("file")
    file_id = change.get("fileId") or (file or {}).get("id")
    if not file_id:
        return

    if change.get("removed") or (file and file.get("trashed")):
        # We keep raw_artifacts (audit trail) but mark them via a delete-tombstone
        # later if needed. For MVP, just skip.
        counts["skipped"] += 1
        return
    if not file:
        return

    in_scope, scope_folder_id = await _is_in_scope(
        gc, session, connection=connection, file=file, allowlist=allowlist
    )
    if not in_scope:
        counts["skipped"] += 1
        return

    mime = file.get("mimeType") or ""
    if mime == MIME_FOLDER:
        await upsert_raw_artifact(
            session,
            source="google",
            kind="drive_folder",
            external_id=f"{connection.account_id}:drive_folder:{file_id}",
            payload={**file, "scope_folder_id": scope_folder_id},
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
            payload={"drive_metadata": file, "document": doc, "scope_folder_id": scope_folder_id},
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
            payload={"drive_metadata": file, "spreadsheet": sheet, "scope_folder_id": scope_folder_id},
        )
        counts["sheets"] += 1
        return

    # Other (PDF, image, slides, etc.)
    await upsert_raw_artifact(
        session,
        source="google",
        kind="drive_file",
        external_id=f"{connection.account_id}:drive_file:{file_id}",
        payload={**file, "scope_folder_id": scope_folder_id},
    )
    counts["drive_files"] += 1


async def _is_in_scope(
    gc: GoogleClient,
    session: AsyncSession,
    *,
    connection: Connection,
    file: dict[str, Any],
    allowlist: set[str],
) -> tuple[bool, str | None]:
    """Decide if a file is in scope. Two paths:
       1. We already ingested it → it's in scope, return its scope_folder_id
       2. Walk parents up to MAX_PARENT_WALK_DEPTH; if any is in allowlist, yes
    """
    file_id = file.get("id")
    if file_id:
        # Path 1 — already ingested?
        existing = await session.execute(
            select(RawArtifact).where(
                RawArtifact.source == "google",
                RawArtifact.external_id.like(f"{connection.account_id}:%:{file_id}"),
            )
        )
        prior = existing.scalars().first()
        if prior:
            scope = (prior.payload or {}).get("scope_folder_id")
            return True, scope

    # Path 2 — walk parents
    parents = file.get("parents") or []
    visited: set[str] = set()
    for _ in range(MAX_PARENT_WALK_DEPTH):
        for p in parents:
            if p in allowlist:
                return True, p
        if not parents:
            return False, None
        next_level: list[str] = []
        for p in parents:
            if p in visited:
                continue
            visited.add(p)
            try:
                meta = await gc.get(
                    f"{DRIVE_FILES_URL}/{p}",
                    params={"fields": "id, parents"},
                )
            except Exception:
                continue
            for grand in (meta.get("parents") or []):
                next_level.append(grand)
        parents = next_level
    return False, None
