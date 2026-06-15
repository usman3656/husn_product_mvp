"""Slack inbound — Events API.

Today this handles:
  * url_verification — the one-time challenge Slack sends when you set the
    Request URL (echoed back so the URL validates).
  * event_callback   — app_mention + message.im (DMs). Signature-verified,
    ACKed within Slack's 3s window, then processed in the background.

For now the background handler posts a "connected" reply so the inbound +
outbound round-trip is provable. Per-user account linking and the full Q&A /
action agent land in the next phase; until then it deliberately does NOT answer
with workspace data (the access model is per-user).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlalchemy import select

from husn.connectors.slack.client import SlackClient
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.session import SessionLocal

router = APIRouter(prefix="/slack", tags=["slack"])

# Reject requests whose timestamp is older than this (replay protection).
_MAX_SKEW_S = 60 * 5


def verify_slack_signature(*, headers: Any, raw_body: bytes, signing_secret: str) -> bool:
    """Validate X-Slack-Signature (v0 HMAC-SHA256 over `v0:{ts}:{body}`)."""
    if not signing_secret:
        return False
    ts = headers.get("x-slack-request-timestamp", "")
    sig = headers.get("x-slack-signature", "")
    if not ts or not sig:
        return False
    try:
        if abs(time.time() - int(ts)) > _MAX_SKEW_S:
            return False
    except ValueError:
        return False
    base = b"v0:" + ts.encode() + b":" + raw_body
    digest = hmac.new(signing_secret.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"v0={digest}", sig)


@router.post("/events")
async def slack_events(request: Request, background: BackgroundTasks) -> Any:
    raw = await request.body()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "invalid payload")

    # 1. URL verification handshake — echo the challenge so Slack accepts the
    # Request URL. No signature needed: it proves URL ownership, carries no data.
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge", "")}

    # 2. Everything else must be signature-verified.
    s = get_settings()
    if not verify_slack_signature(
        headers=request.headers, raw_body=raw, signing_secret=s.slack_signing_secret
    ):
        # Most common cause during setup: SLACK_SIGNING_SECRET not set yet.
        if not s.slack_signing_secret:
            log.warning("husn.slack.events.no_signing_secret")
        raise HTTPException(401, "bad slack signature")

    # 3. Slack retries on non-2xx or >3s — ACK immediately, work in background.
    if payload.get("type") == "event_callback" and not request.headers.get("x-slack-retry-num"):
        background.add_task(_process_event, payload)
    return {"ok": True}


def _clean_text(text: str) -> str:
    """Strip the leading <@BOT> mention so the user's actual words remain."""
    import re

    return re.sub(r"<@[A-Z0-9]+>", "", text or "").strip()


async def _process_event(payload: dict) -> None:
    """Resolve the workspace's bot token and post a reply. Loop-safe."""
    event = payload.get("event") or {}
    etype = event.get("type")
    # Ignore the bot's own posts / edits / joins to avoid reply loops.
    if event.get("bot_id") or event.get("subtype"):
        return
    if etype == "message" and event.get("channel_type") != "im":
        return  # only DMs for `message`; channels come via app_mention
    if etype not in ("app_mention", "message"):
        return

    team_id = payload.get("team_id")
    channel = event.get("channel")
    if not team_id or not channel:
        return
    thread_ts = event.get("thread_ts") or event.get("ts") if etype == "app_mention" else None
    asked = _clean_text(event.get("text", ""))

    async with SessionLocal() as session:
        conn = (
            await session.execute(
                select(Connection).where(
                    Connection.source == "slack",
                    Connection.account_id == str(team_id),
                )
            )
        ).scalar_one_or_none()
        if conn is None:
            log.warning("husn.slack.events.no_connection", team_id=team_id)
            return

        reply = (
            "👋 Husn is connected to Slack. I received your message"
            + (f" — “{asked[:140]}”." if asked else ".")
            + "\n\nFull Q&A and actions are being switched on. Once your account "
            "is linked you'll be able to ask about your briefing and take actions "
            "right here."
        )
        try:
            async with SlackClient(connection=conn) as sc:
                await sc.post_message(channel=channel, text=reply, thread_ts=thread_ts)
        except Exception as e:  # noqa: BLE001
            # Most likely cause until reinstall: missing chat:write scope.
            log.warning("husn.slack.events.post_failed", err=str(e)[:200])
