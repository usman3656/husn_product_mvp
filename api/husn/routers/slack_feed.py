"""Slack-shaped feed endpoint: channels with their recent messages grouped."""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_member
from husn.auth.scope import tenant_where
from husn.db.models import RawArtifact
from husn.db.session import get_session

router = APIRouter(prefix="/api/slack", tags=["slack"])


@router.get("/feed")
async def feed(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Return channels + their messages, grouped, sorted newest-message-first."""
    ch_stmt = tenant_where(
        select(RawArtifact)
        .where(RawArtifact.source == "slack", RawArtifact.kind == "channel")
        .order_by(RawArtifact.fetched_at.desc()),
        RawArtifact,
        ctx,
    )
    msg_stmt = tenant_where(
        select(RawArtifact)
        .where(RawArtifact.source == "slack", RawArtifact.kind == "message")
        .order_by(RawArtifact.fetched_at.desc())
        .limit(2000),
        RawArtifact,
        ctx,
    )
    user_stmt = tenant_where(
        select(RawArtifact).where(
            RawArtifact.source == "slack", RawArtifact.kind == "user"
        ),
        RawArtifact,
        ctx,
    )

    channels = (await session.execute(ch_stmt)).scalars().all()
    messages = (await session.execute(msg_stmt)).scalars().all()
    users = (await session.execute(user_stmt)).scalars().all()

    user_lookup: dict[str, str] = {}
    for u in users:
        p = u.payload or {}
        uid = p.get("id")
        if not uid:
            continue
        user_lookup[uid] = (
            p.get("real_name") or p.get("name") or (p.get("profile") or {}).get("real_name") or uid
        )

    # Group messages by channel_id
    by_channel: dict[str, list[dict]] = {}
    for m in messages:
        p = m.payload or {}
        cid = p.get("channel_id")
        if not cid:
            continue
        text = (p.get("text") or "").strip()
        author_id = p.get("user") or p.get("bot_id") or ""
        by_channel.setdefault(cid, []).append(
            {
                "ts": p.get("ts"),
                "text": text,
                "author_id": author_id,
                "author_name": user_lookup.get(author_id, author_id or "(unknown)"),
                "thread_ts": p.get("thread_ts"),
                "reply_count": p.get("reply_count"),
            }
        )

    channels_out: list[dict] = []
    for ch in channels:
        p = ch.payload or {}
        cid = p.get("id")
        msgs = by_channel.get(cid, [])
        channels_out.append(
            {
                "id": cid,
                "name": p.get("name"),
                "is_member": bool(p.get("is_member")),
                "is_archived": bool(p.get("is_archived")),
                "num_members": p.get("num_members"),
                "topic": (p.get("topic") or {}).get("value"),
                "purpose": (p.get("purpose") or {}).get("value"),
                "message_count": len(msgs),
                "messages": msgs,
            }
        )

    # Sort: bot-in-channel first, then by message count desc, then name
    channels_out.sort(key=lambda c: (not c["is_member"], -c["message_count"], c["name"] or ""))

    return {
        "channels": channels_out,
        "total_messages": sum(c["message_count"] for c in channels_out),
    }
