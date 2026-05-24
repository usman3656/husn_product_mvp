"""Outlook backfill — per-allowlisted-folder paginated message fetch.

For first run we use the /messages/delta endpoint with no skip token, which
returns up to 50 messages per page + a deltaLink for incremental sync later.
That deltaLink is captured on the Connection and used by the delta-sync pass.

Capped at MAX_MESSAGES_PER_FOLDER_PER_RUN to bound first-run cost.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.microsoft.client import MicrosoftClient
from husn.core.logging import log
from husn.db.models import Connection, ProjectSource, RawArtifact
from husn.db.upsert import upsert_raw_artifact

MAX_MESSAGES_PER_FOLDER_PER_RUN = 200


async def get_allowlist_outlook_folders(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(ProjectSource).where(
            ProjectSource.source == "microsoft",
            ProjectSource.scope_kind == "outlook_folder",
        )
    )
    return [r.scope_id for r in result.scalars().all()]


async def backfill_outlook(session: AsyncSession, connection: Connection) -> dict[str, Any]:
    counts = {"folders": 0, "messages": 0, "skipped": 0}
    folder_ids = await get_allowlist_outlook_folders(session)
    if not folder_ids:
        return counts

    # Per-folder deltaLinks stored on connection.extra so we can resume.
    extra = dict(connection.extra or {})
    outlook_deltas = dict(extra.get("outlook_deltas") or {})

    async with MicrosoftClient(connection=connection, session=session) as mc:
        for folder_id in folder_ids:
            counts["folders"] += 1
            # If we already have a deltaLink for this folder, use it (delta path).
            # Otherwise start with /messages?$top=50 (initial backfill).
            next_url = outlook_deltas.get(folder_id) or (
                f"/me/mailFolders/{folder_id}/messages"
                "?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,"
                "sentDateTime,bodyPreview,body,conversationId,categories,parentFolderId,"
                "internetMessageId,isRead"
                "&$top=50"
                "&$orderby=receivedDateTime desc"
            )

            ingested_for_folder = 0
            new_delta_link: str | None = None
            while next_url and ingested_for_folder < MAX_MESSAGES_PER_FOLDER_PER_RUN:
                try:
                    body = await mc.get(next_url)
                except Exception:
                    log.exception("husn.microsoft.outlook.list_failed", folder=folder_id)
                    counts["skipped"] += 1
                    break

                for msg in body.get("value", []) or []:
                    msg_id = msg.get("id")
                    if not msg_id:
                        continue
                    await upsert_raw_artifact(
                        session,
                        source="microsoft",
                        kind="email",
                        external_id=f"{connection.account_id}:email:{msg_id}",
                        payload={**msg, "folder_id": folder_id},
                    )
                    counts["messages"] += 1
                    ingested_for_folder += 1
                    if ingested_for_folder >= MAX_MESSAGES_PER_FOLDER_PER_RUN:
                        break

                # Graph returns either nextLink (more pages of CURRENT delta page)
                # or deltaLink (end of stream, use this on next sync).
                if "@odata.deltaLink" in body:
                    new_delta_link = body["@odata.deltaLink"]
                    next_url = None
                else:
                    next_url = body.get("@odata.nextLink")

            if new_delta_link:
                outlook_deltas[folder_id] = new_delta_link
            await session.commit()  # per-folder commit so partial progress sticks

    extra["outlook_deltas"] = outlook_deltas
    connection.extra = extra
    await session.commit()
    log.info(
        "husn.microsoft.outlook.backfill.done",
        account_id=connection.account_id,
        **counts,
    )
    return counts
