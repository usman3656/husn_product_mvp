"""Gmail incremental sync using the history API.

First run (no history_id stored on Connection):
  1. Run a full backfill via existing backfill_gmail
  2. Capture the latest historyId across the ingested messages

Subsequent runs:
  1. Read history_id from connection.extra.gmail_history_id
  2. Call `users.history.list?startHistoryId=<id>&historyTypes=...`
  3. For each `messageAdded` / `labelAdded` event: if any label intersects
     our allowlist, fetch the full message and upsert
  4. Persist the new max historyId

Cursor invalidation (Gmail returns 404 when historyId is too old, typically
older than ~30 days): fall back to a full backfill.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.backfill_gmail import (
    GMAIL_GET_URL_PATTERN,
    backfill_gmail,
    get_allowlist_labels,
)
from husn.connectors.google.client import GoogleClient
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.upsert import upsert_raw_artifact

GMAIL_HISTORY_URL = "https://gmail.googleapis.com/gmail/v1/users/me/history"
GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"


async def sync_gmail(session: AsyncSession, connection: Connection) -> dict[str, int]:
    extra = dict(connection.extra or {})
    history_id = extra.get("gmail_history_id")
    label_ids = await get_allowlist_labels(session)
    if not label_ids:
        return {"skipped": 1}
    label_set = set(label_ids)

    if not history_id:
        # First run: capture the current mailbox historyId BEFORE backfilling
        # so deltas from it are guaranteed valid. Backfill catches "everything
        # up to ~now"; any messages that arrive during backfill will appear
        # again in the next delta (upserts are idempotent — no duplication).
        async with GoogleClient(connection=connection, session=session) as gc:
            profile = await gc.get(GMAIL_PROFILE_URL)
        bootstrap_history_id = profile.get("historyId")
        counts = await backfill_gmail(session, connection)
        if bootstrap_history_id:
            extra["gmail_history_id"] = str(bootstrap_history_id)
            connection.extra = extra
            await session.commit()
            log.info(
                "husn.google.gmail.cursor.init",
                account_id=connection.account_id,
                history_id=bootstrap_history_id,
            )
        return {**counts, "mode": "initial_backfill"}

    counts = {"history_records": 0, "messages": 0, "skipped": 0}
    async with GoogleClient(connection=connection, session=session) as gc:
        new_history_id: str | None = None
        page_token: str | None = None
        # Track which message ids we've fetched this run to avoid duplicate work
        seen: set[str] = set()
        while True:
            # historyTypes must be REPEATED query params, not comma-separated.
            # httpx encodes a list as repeated keys: ?historyTypes=...&historyTypes=...
            params: dict[str, Any] = {
                "startHistoryId": history_id,
                "historyTypes": ["messageAdded", "labelAdded"],
            }
            if page_token:
                params["pageToken"] = page_token
            try:
                body = await gc.get(GMAIL_HISTORY_URL, params=params)
            except Exception:
                log.exception(
                    "husn.google.gmail.history.failed; resetting cursor",
                    history_id=history_id,
                )
                extra["gmail_history_id"] = None
                connection.extra = extra
                await session.commit()
                return {"reset": True, **counts}

            records = body.get("history", []) or []
            counts["history_records"] += len(records)
            for rec in records:
                await _process_history_record(
                    gc, session,
                    connection=connection, record=rec,
                    label_set=label_set, seen=seen, counts=counts,
                )
            new_history_id = body.get("historyId") or new_history_id
            page_token = body.get("nextPageToken")
            if not page_token:
                break

        if new_history_id:
            extra["gmail_history_id"] = str(new_history_id)
            connection.extra = extra
            await session.commit()

    if counts["history_records"]:
        log.info("husn.google.gmail.sync", account_id=connection.account_id, **counts)
    return {**counts, "mode": "delta"}


async def _process_history_record(
    gc: GoogleClient,
    session: AsyncSession,
    *,
    connection: Connection,
    record: dict[str, Any],
    label_set: set[str],
    seen: set[str],
    counts: dict[str, int],
) -> None:
    """A single history record can contain messagesAdded[], labelsAdded[], etc."""
    candidate_ids: set[str] = set()

    # messagesAdded events
    for entry in record.get("messagesAdded", []) or []:
        msg = entry.get("message") or {}
        msg_id = msg.get("id")
        msg_labels = set(msg.get("labelIds") or [])
        if msg_id and (label_set & msg_labels):
            candidate_ids.add(msg_id)

    # labelsAdded events — a message just got labeled with one of ours
    for entry in record.get("labelsAdded", []) or []:
        added = set(entry.get("labelIds") or [])
        if not (label_set & added):
            continue
        msg = entry.get("message") or {}
        msg_id = msg.get("id")
        if msg_id:
            candidate_ids.add(msg_id)

    for msg_id in candidate_ids:
        if msg_id in seen:
            continue
        seen.add(msg_id)
        try:
            full = await gc.get(
                GMAIL_GET_URL_PATTERN.format(id=msg_id),
                params={"format": "full"},
            )
        except Exception:
            counts["skipped"] += 1
            continue
        await upsert_raw_artifact(
            session,
            source="google",
            kind="email",
            external_id=f"{connection.account_id}:email:{full.get('id')}",
            payload=full,
            tenant_id=connection.tenant_id,
        )
        counts["messages"] += 1


