"""OneDrive backfill — recursive walk of allowlisted folders.

Files are classified by MIME / extension:
  * Office Word (.docx)  → kind='office_doc'
  * Office Excel (.xlsx) → kind='office_sheet'
  * Office PowerPoint    → kind='office_slides'
  * everything else      → kind='drive_file' (metadata only)

Content extraction for Office formats is intentionally deferred — Graph
returns binary streams that need python-docx / openpyxl / python-pptx parsing.
v1 ships metadata only; v2 will add content fetch + parse.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.microsoft.client import MicrosoftClient
from husn.core.logging import log
from husn.db.models import Connection, ProjectSource
from husn.db.upsert import upsert_raw_artifact

MAX_FILES_PER_FOLDER_PER_RUN = 200

EXT_TO_KIND = {
    ".docx": "office_doc",
    ".doc": "office_doc",
    ".dotx": "office_doc",
    ".xlsx": "office_sheet",
    ".xls": "office_sheet",
    ".xlsm": "office_sheet",
    ".pptx": "office_slides",
    ".ppt": "office_slides",
}


async def get_allowlist_onedrive_folders(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(ProjectSource).where(
            ProjectSource.source == "microsoft",
            ProjectSource.scope_kind == "onedrive_folder",
        )
    )
    return [r.scope_id for r in result.scalars().all()]


def _classify(item: dict[str, Any]) -> str:
    name = (item.get("name") or "").lower()
    for ext, kind in EXT_TO_KIND.items():
        if name.endswith(ext):
            return kind
    return "drive_file"


async def backfill_drive(session: AsyncSession, connection: Connection) -> dict[str, int]:
    counts = {
        "folders": 0,
        "office_docs": 0,
        "office_sheets": 0,
        "office_slides": 0,
        "drive_files": 0,
        "skipped": 0,
    }
    folder_ids = await get_allowlist_onedrive_folders(session)
    if not folder_ids:
        return counts

    async with MicrosoftClient(connection=connection, session=session) as mc:
        for root_id in folder_ids:
            counts["folders"] += 1
            await _walk_folder(
                mc, session, connection=connection, folder_id=root_id, counts=counts
            )
            await session.commit()

    log.info(
        "husn.microsoft.drive.backfill.done",
        account_id=connection.account_id,
        **counts,
    )
    return counts


async def _walk_folder(
    mc: MicrosoftClient,
    session: AsyncSession,
    *,
    connection: Connection,
    folder_id: str,
    counts: dict[str, int],
    depth: int = 0,
    max_depth: int = 8,
) -> None:
    if depth > max_depth:
        log.warning("husn.microsoft.drive.depth_capped", folder_id=folder_id)
        return

    processed = 0
    next_url: str | None = (
        f"/me/drive/items/{folder_id}/children"
        "?$select=id,name,folder,file,size,lastModifiedDateTime,webUrl,parentReference,"
        "createdBy,lastModifiedBy"
        "&$top=200"
    )
    while next_url:
        try:
            body = await mc.get(next_url)
        except Exception:
            log.exception("husn.microsoft.drive.list_failed", folder=folder_id)
            counts["skipped"] += 1
            return

        for item in body.get("value", []) or []:
            if processed >= MAX_FILES_PER_FOLDER_PER_RUN:
                log.info("husn.microsoft.drive.cap_hit", folder=folder_id)
                return
            item_id = item.get("id")
            if not item_id:
                continue
            if item.get("folder"):
                await upsert_raw_artifact(
                    session,
                    source="microsoft",
                    kind="drive_folder",
                    external_id=f"{connection.account_id}:drive_folder:{item_id}",
                    payload={**item, "scope_folder_id": folder_id},
                    tenant_id=connection.tenant_id,
                )
                await _walk_folder(
                    mc,
                    session,
                    connection=connection,
                    folder_id=item_id,
                    counts=counts,
                    depth=depth + 1,
                )
                processed += 1
                continue

            kind = _classify(item)
            await upsert_raw_artifact(
                session,
                source="microsoft",
                kind=kind,
                external_id=f"{connection.account_id}:{kind}:{item_id}",
                payload={**item, "scope_folder_id": folder_id},
                tenant_id=connection.tenant_id,
            )
            count_key = (
                "office_docs"
                if kind == "office_doc"
                else "office_sheets"
                if kind == "office_sheet"
                else "office_slides"
                if kind == "office_slides"
                else "drive_files"
            )
            counts[count_key] += 1
            processed += 1

        next_url = body.get("@odata.nextLink")
