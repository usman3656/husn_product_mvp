"""Gmail backfill — per-label paginated fetch, full-message hydrate, upsert.

Scope: only labels in project_sources(source='google', scope_kind='gmail_label').
The user picks these in the dashboard allowlist; nothing else is read.

Strategy:
  1. For each allowed label, find the latest internalDate already ingested
     (so subsequent runs only pull new messages — keeps cost flat).
  2. Page through messages.list with `q=after:<unix_ts> label:<label_id>`.
  3. For each new message id, GET messages.get?format=full and store the raw
     response in raw_artifacts.

Capped at 200 messages per label per run so the first ever ingest doesn't
hammer the API. With cron running every minute, the cap is irrelevant after
the first pass — there'll be ~0–5 new messages between runs.
"""

import base64
import binascii
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.client import GoogleClient
from husn.core.logging import log
from husn.db.models import Connection, ProjectSource, RawArtifact
from husn.db.upsert import upsert_raw_artifact

GMAIL_LIST_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
GMAIL_GET_URL_PATTERN = "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
MAX_MESSAGES_PER_LABEL_PER_RUN = 200


async def get_allowlist_labels(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(ProjectSource).where(
            ProjectSource.source == "google",
            ProjectSource.scope_kind == "gmail_label",
        )
    )
    return [r.scope_id for r in result.scalars().all()]


async def _latest_internal_date_for_label(
    session: AsyncSession, account_id: str, label_id: str
) -> int | None:
    """Return the maximum internalDate (ms epoch) we've stored for this label.

    Used to filter messages.list to only-new messages on subsequent runs.
    Gmail's `q=after:<unix_seconds>` operator does this server-side.
    """
    # Stored as payload->>'internalDate' which is a string (ms epoch)
    result = await session.execute(
        select(func.max(RawArtifact.payload["internalDate"].astext.cast(
            __import__("sqlalchemy").BigInteger
        ))).where(
            RawArtifact.source == "google",
            RawArtifact.kind == "email",
            RawArtifact.payload["labelIds"].astext.like(f"%{label_id}%"),
        )
    )
    val = result.scalar()
    return int(val) if val is not None else None


async def backfill_gmail(session: AsyncSession, connection: Connection) -> dict[str, int]:
    counts = {"labels": 0, "messages": 0, "skipped": 0}
    label_ids = await get_allowlist_labels(session)
    if not label_ids:
        return counts

    async with GoogleClient(connection=connection, session=session) as gc:
        for label_id in label_ids:
            counts["labels"] += 1
            latest_ms = await _latest_internal_date_for_label(
                session, connection.account_id, label_id
            )
            q_parts: list[str] = []
            if latest_ms is not None:
                # +1 second to avoid re-fetching the latest message
                q_parts.append(f"after:{int(latest_ms / 1000) + 1}")
            q = " ".join(q_parts) if q_parts else None

            ids = await _list_message_ids(gc, label_id=label_id, q=q)
            ids = ids[:MAX_MESSAGES_PER_LABEL_PER_RUN]
            log.info(
                "husn.google.gmail.list",
                label=label_id,
                new_messages=len(ids),
                latest_ms=latest_ms,
            )

            for msg_id in ids:
                try:
                    msg = await gc.get(
                        GMAIL_GET_URL_PATTERN.format(id=msg_id),
                        params={"format": "full"},
                    )
                except Exception:
                    log.exception("husn.google.gmail.get_failed", message_id=msg_id)
                    counts["skipped"] += 1
                    continue
                await upsert_raw_artifact(
                    session,
                    source="google",
                    kind="email",
                    external_id=f"{connection.account_id}:email:{msg.get('id')}",
                    payload=msg,
                    tenant_id=connection.tenant_id,
                )
                counts["messages"] += 1
            await session.commit()  # commit per-label so partial progress sticks

    log.info("husn.google.gmail.backfill.done", account_id=connection.account_id, **counts)
    return counts


async def _list_message_ids(
    gc: GoogleClient, *, label_id: str, q: str | None
) -> list[str]:
    ids: list[str] = []
    page_token: str | None = None
    while True:
        params: dict[str, Any] = {
            "labelIds": label_id,
            "maxResults": 100,
        }
        if q:
            params["q"] = q
        if page_token:
            params["pageToken"] = page_token
        body = await gc.get(GMAIL_LIST_URL, params=params)
        for m in body.get("messages", []) or []:
            mid = m.get("id")
            if mid:
                ids.append(mid)
        page_token = body.get("nextPageToken")
        # Stop early if we've already exceeded the per-run cap
        if not page_token or len(ids) >= MAX_MESSAGES_PER_LABEL_PER_RUN:
            break
    return ids


# ---------------- Helpers for normalizer (exported, not used here) -----------------


def gmail_header(payload: dict, name: str) -> str | None:
    """Get an RFC822 header value from a Gmail message payload."""
    for h in (payload.get("headers") or []):
        if (h.get("name") or "").lower() == name.lower():
            return h.get("value")
    return None


def gmail_plain_body(payload: dict) -> str:
    """Walk MIME parts looking for text/plain (preferred) or text/html (stripped).

    Gmail base64url-encodes part bodies.
    """
    text_plain: list[str] = []
    text_html: list[str] = []

    def walk(node: dict) -> None:
        mime = node.get("mimeType") or ""
        body = node.get("body") or {}
        data = body.get("data")
        if data:
            try:
                decoded = base64.urlsafe_b64decode(data + "===").decode(
                    "utf-8", errors="replace"
                )
            except (binascii.Error, ValueError):
                decoded = ""
            if mime.startswith("text/plain"):
                text_plain.append(decoded)
            elif mime.startswith("text/html"):
                text_html.append(decoded)
        for child in (node.get("parts") or []):
            walk(child)

    walk(payload)
    if text_plain:
        return "\n".join(text_plain).strip()
    if text_html:
        # Crude tag strip — agent will see meaningful text without nesting
        import re

        joined = "\n".join(text_html)
        return re.sub(r"<[^>]+>", " ", joined).strip()
    return ""
