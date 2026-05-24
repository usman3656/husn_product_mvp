"""OneDrive incremental sync via Graph's per-folder delta endpoint.

For each allowlisted folder we call the right `/delta` endpoint:
  - User-drive folder (plain id):       /me/drive/items/{id}/delta
  - Shared / mounted folder (remoteItem): /drives/{drive_id}/items/{id}/delta

The first call returns ALL items inside the folder (paginated via
`@odata.nextLink`) ending in `@odata.deltaLink`. Subsequent calls use the
stored deltaLink and return only changes since.

This is BOTH the initial backfill and the steady-state delta sync — same
endpoint, same pagination, same cursor shape. No separate recursive walk.

Allowlist scope encoding (the value in project_sources.scope_id):
  - "<item_id>"                   → user's own drive folder
  - "remote:<drive_id>:<item_id>" → folder shared/mounted into the user's
                                    drive (e.g. an org Project Atlas folder
                                    added via "Add shortcut to My files")

Cursors live on connection.extra.drive_deltas, keyed by the encoded scope:
  {"<scope_id>": "<deltaLink>", ...}
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.microsoft.backfill_drive import (
    _classify,
    get_allowlist_onedrive_folders,
)
from husn.connectors.microsoft.client import MicrosoftClient
from husn.connectors.microsoft.content import extract_text, is_extractable
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.upsert import upsert_raw_artifact


async def sync_drive(session: AsyncSession, connection: Connection) -> dict[str, Any]:
    counts = {
        "folders": 0,
        "changes_returned": 0,
        "office_docs": 0,
        "office_sheets": 0,
        "office_slides": 0,
        "drive_files": 0,
        "skipped": 0,
    }
    folder_ids = await get_allowlist_onedrive_folders(session)
    if not folder_ids:
        return counts

    extra = dict(connection.extra or {})
    drive_deltas: dict[str, str] = dict(extra.get("drive_deltas") or {})

    async with MicrosoftClient(connection=connection, session=session) as mc:
        for scope in folder_ids:
            counts["folders"] += 1
            cursor = drive_deltas.get(scope)
            # Initial run for this scope → start at /delta with no token.
            # Subsequent runs → use stored deltaLink.
            next_url = cursor or _delta_path_for_scope(scope)
            new_delta: str | None = None
            while next_url:
                try:
                    body = await mc.get(next_url)
                except Exception:
                    log.exception(
                        "husn.microsoft.drive.delta.failed; resetting folder cursor",
                        scope=scope,
                    )
                    drive_deltas.pop(scope, None)
                    next_url = None
                    break

                items = body.get("value", []) or []
                counts["changes_returned"] += len(items)
                for item in items:
                    if item.get("deleted"):
                        counts["skipped"] += 1
                        continue
                    await _ingest_item(
                        mc,
                        session,
                        connection=connection,
                        item=item,
                        scope=scope,
                        counts=counts,
                    )

                new_delta = body.get("@odata.deltaLink") or new_delta
                next_url = body.get("@odata.nextLink")

            if new_delta:
                drive_deltas[scope] = new_delta
            await session.commit()  # commit per-scope so partial progress sticks

    extra["drive_deltas"] = drive_deltas
    # Clear any pre-existing legacy single-cursor key from the older code path
    extra.pop("drive_delta_link", None)
    connection.extra = extra
    await session.commit()

    if counts["changes_returned"]:
        log.info(
            "husn.microsoft.drive.sync",
            account_id=connection.account_id,
            **counts,
        )
    return {**counts, "mode": "delta"}


def _delta_path_for_scope(scope: str) -> str:
    """Pick the right Graph /delta URL for a stored scope id.

    - "remote:<drive_id>:<item_id>" → /drives/{drive_id}/items/{item_id}/delta
    - "<item_id>"                   → /me/drive/items/{item_id}/delta
    """
    if scope.startswith("remote:"):
        _, drive_id, item_id = scope.split(":", 2)
        return f"/drives/{drive_id}/items/{item_id}/delta"
    return f"/me/drive/items/{scope}/delta"


def _scope_item_id(scope: str) -> str:
    """Extract the actual Graph item id from a stored scope id.

    Needed to recognise the "scope root in its own response" line in delta
    output (we don't want to re-ingest the scope folder as a sub-folder of
    itself).
    """
    if scope.startswith("remote:"):
        return scope.split(":", 2)[2]
    return scope


async def _ingest_item(
    mc: MicrosoftClient,
    session: AsyncSession,
    *,
    connection: Connection,
    item: dict[str, Any],
    scope: str,
    counts: dict[str, int],
) -> None:
    item_id = item.get("id")
    if not item_id:
        return

    # The delta endpoint includes the scope folder itself in the first response.
    if item_id == _scope_item_id(scope):
        return

    if item.get("folder"):
        await upsert_raw_artifact(
            session,
            source="microsoft",
            kind="drive_folder",
            external_id=f"{connection.account_id}:drive_folder:{item_id}",
            payload={**item, "scope_folder_id": scope},
        )
        return

    if not item.get("file"):
        counts["skipped"] += 1
        return

    # Download + extract text if this is a text-y file type. The cost is one
    # extra Graph call per file, capped at MAX_DOWNLOAD_BYTES, so it scales.
    extracted_text: str | None = None
    if is_extractable(item):
        extracted_text = await extract_text(mc, item)

    kind = _classify(item)
    payload = {**item, "scope_folder_id": scope}
    if extracted_text:
        payload["_extracted_text"] = extracted_text

    await upsert_raw_artifact(
        session,
        source="microsoft",
        kind=kind,
        external_id=f"{connection.account_id}:{kind}:{item_id}",
        payload=payload,
    )
    bucket = (
        "office_docs"
        if kind == "office_doc"
        else "office_sheets"
        if kind == "office_sheet"
        else "office_slides"
        if kind == "office_slides"
        else "drive_files"
    )
    counts[bucket] += 1
