"""Slack backfill: ingest channels + recent messages.

Channels: public only for MVP (channels:read + channels:history scopes).
Per channel we pull the most recent N messages; full history is bounded by
the message_limit_per_channel argument to keep first-run cheap.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.slack.client import SlackClient
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.upsert import upsert_raw_artifact


async def backfill_connection(
    session: AsyncSession,
    connection: Connection,
    *,
    message_limit_per_channel: int = 200,
) -> dict[str, int]:
    counts = {"channels": 0, "messages": 0, "users": 0}
    async with SlackClient(connection=connection) as sc:
        # 1. Users — small directory; useful for resolving message authors later
        cursor: str | None = None
        while True:
            resp = await sc.users_list(cursor=cursor)
            for u in resp.get("members", []) or []:
                if u.get("deleted") or u.get("is_bot"):
                    # Skip deactivated + bots from the directory to keep raw small;
                    # message ingestion still records the user id verbatim.
                    continue
                await upsert_raw_artifact(
                    session,
                    source="slack",
                    kind="user",
                    external_id=f"{connection.account_id}:user:{u['id']}",
                    payload=u,
                )
                counts["users"] += 1
            cursor = (resp.get("response_metadata") or {}).get("next_cursor") or None
            if not cursor:
                break

        # 2. Public channels
        channels: list[dict] = []
        cursor = None
        while True:
            resp = await sc.conversations_list(cursor=cursor)
            for ch in resp.get("channels", []) or []:
                channels.append(ch)
                await upsert_raw_artifact(
                    session,
                    source="slack",
                    kind="channel",
                    external_id=f"{connection.account_id}:channel:{ch['id']}",
                    payload=ch,
                )
                counts["channels"] += 1
            cursor = (resp.get("response_metadata") or {}).get("next_cursor") or None
            if not cursor:
                break

        # Commit channel/user upserts before we start the (slower) message loop
        await session.commit()

        # 3. Messages per channel — only channels the bot is a member of can be
        # read via conversations.history. Slack returns "not_in_channel" for the
        # rest; we soft-skip those rather than fail the whole backfill.
        for ch in channels:
            if not ch.get("is_member"):
                continue
            await _backfill_channel_messages(
                sc, session, connection, ch, message_limit_per_channel, counts
            )

    await session.commit()
    log.info("husn.slack.backfill.done", account_id=connection.account_id, **counts)
    return counts


async def _backfill_channel_messages(
    sc: SlackClient,
    session: AsyncSession,
    connection: Connection,
    channel: dict,
    limit_total: int,
    counts: dict[str, int],
) -> None:
    channel_id = channel["id"]
    ingested = 0
    cursor: str | None = None
    while ingested < limit_total:
        page_limit = min(100, limit_total - ingested)
        try:
            resp = await sc.conversations_history(channel=channel_id, limit=page_limit, cursor=cursor)
        except RuntimeError as e:
            # Soft-skip channels we can't read (not_in_channel, channel_not_found, etc.)
            if "not_in_channel" in str(e) or "channel_not_found" in str(e):
                log.info("husn.slack.backfill.skip_channel", channel=channel_id, reason=str(e))
                return
            raise
        for msg in resp.get("messages", []) or []:
            # Slack uses (channel, ts) as the natural unique key for a message.
            await upsert_raw_artifact(
                session,
                source="slack",
                kind="message",
                external_id=f"{connection.account_id}:message:{channel_id}:{msg['ts']}",
                payload={**msg, "channel_id": channel_id, "channel_name": channel.get("name")},
            )
            counts["messages"] += 1
            ingested += 1
        if not resp.get("has_more"):
            break
        cursor = (resp.get("response_metadata") or {}).get("next_cursor") or None
        if not cursor:
            break


async def get_connections(session: AsyncSession) -> list[Connection]:
    result = await session.execute(select(Connection).where(Connection.source == "slack"))
    return list(result.scalars().all())
