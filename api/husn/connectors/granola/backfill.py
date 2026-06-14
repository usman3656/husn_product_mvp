"""Granola backfill: ingest meeting notes (title + AI summary).

Incremental: we remember the newest note's created timestamp in
connection.extra["granola_created_after"] and only ask for notes created after
it on the next pass. Each note is upserted as a `meeting` raw_artifact keyed on
the stable Granola note id (so a rotated API key never duplicates data).

We fetch the note DETAIL (title + summary) but not the transcript — the summary
is what feeds the briefing, and transcripts would bloat raw_artifacts.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.granola.client import GranolaClient
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.upsert import upsert_raw_artifact

# Bounds so a first run on a large workspace stays cheap and can't loop forever.
MAX_NOTES_PER_RUN = 500
MAX_PAGES_PER_RUN = 50


def _note_id(note: dict[str, Any]) -> str | None:
    nid = note.get("id") or note.get("note_id") or note.get("document_id")
    return str(nid) if nid else None


def _created_at(note: dict[str, Any]) -> str | None:
    return note.get("created_at") or note.get("created") or note.get("createdAt")


async def backfill_connection(
    session: AsyncSession, connection: Connection
) -> dict[str, int]:
    counts = {"meetings": 0}
    extra: dict[str, Any] = dict(connection.extra or {})
    created_after: str | None = extra.get("granola_created_after")
    newest_seen: str | None = created_after

    async with GranolaClient(connection=connection) as gc:
        cursor: str | None = None
        pages = 0
        while pages < MAX_PAGES_PER_RUN and counts["meetings"] < MAX_NOTES_PER_RUN:
            pages += 1
            resp = await gc.list_notes(created_after=created_after, cursor=cursor)
            notes = resp.get("notes") or []
            for note in notes:
                nid = _note_id(note)
                if not nid:
                    continue
                # Pull the full note (title + summary); fall back to the list
                # item if the detail call fails for one note.
                try:
                    detail = await gc.get_note(nid)
                except Exception as e:  # noqa: BLE001 — one bad note shouldn't abort the run
                    log.warning("husn.granola.note_detail_failed", note_id=nid, err=str(e)[:200])
                    detail = {}
                payload = {**note, **detail}

                await upsert_raw_artifact(
                    session,
                    source="granola",
                    kind="meeting",
                    external_id=f"granola:meeting:{nid}",
                    payload=payload,
                    tenant_id=connection.tenant_id,
                )
                counts["meetings"] += 1

                created = _created_at(payload)
                if created and (newest_seen is None or created > newest_seen):
                    newest_seen = created

                if counts["meetings"] >= MAX_NOTES_PER_RUN:
                    break

            cursor = resp.get("cursor") or None
            if not resp.get("hasMore") or not cursor:
                break

    # Persist the incremental watermark so the next pass only fetches newer notes.
    if newest_seen and newest_seen != created_after:
        extra["granola_created_after"] = newest_seen
        connection.extra = extra

    await session.commit()
    log.info("husn.granola.backfill.done", account_id=connection.account_id, **counts)
    return counts


async def get_connections(session: AsyncSession) -> list[Connection]:
    result = await session.execute(select(Connection).where(Connection.source == "granola"))
    return list(result.scalars().all())
