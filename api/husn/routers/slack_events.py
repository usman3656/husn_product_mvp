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
import re
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlalchemy import select

from husn.agent.chat import run_chat_turn
from husn.agent.email_intent import extract_email, looks_like_email_request, resolve_recipients
from husn.agent.llm import RateLimitedError, get_llm_client
from husn.connectors.slack.client import SlackClient
from husn.core.config import get_settings
from husn.core.logging import log
from husn.core.oauth import sign_token
from husn.db.models import Connection, PendingAction, SlackIdentity
from husn.db.session import SessionLocal
from husn.graph.projects import get_or_create_default_project
from husn.graph.tenancy_context import current_tenant_id
from husn.routers.slack_link import LINK_TOKEN_SOURCE
from husn.usage import record_token_usage

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
    return re.sub(r"<@[A-Z0-9]+>", "", text or "").strip()


def _format_for_slack(text: str) -> str:
    """Drop the inline [claim N]/[artifact N]/[finding N] citation markers —
    useful in the web UI, noise in a Slack message."""
    return re.sub(r"\s*\[(?:claim|artifact|finding)\s+\d+\]", "", text or "").strip()


async def _post(
    conn: Connection,
    channel: str,
    text: str,
    thread_ts: str | None,
    blocks: list[dict] | None = None,
) -> None:
    try:
        async with SlackClient(connection=conn) as sc:
            await sc.post_message(channel=channel, text=text, thread_ts=thread_ts, blocks=blocks)
    except Exception as e:  # noqa: BLE001 — until reinstall this is missing chat:write
        log.warning("husn.slack.events.post_failed", err=str(e)[:200])


def _email_confirm_blocks(
    pending_id: int, to: list[str], subject: str, body: str, unresolved: list[str]
) -> list[dict]:
    preview = body if len(body) <= 1500 else body[:1500] + "…"
    txt = (
        f"*Send this email?*\n*To:* {', '.join(to)}\n"
        f"*Subject:* {subject or '(none)'}\n\n{preview}"
    )
    if unresolved:
        txt += f"\n\n_Couldn't resolve (won't be emailed): {', '.join(unresolved)}_"
    return [
        {"type": "section", "text": {"type": "mrkdwn", "text": txt[:2900]}},
        {
            "type": "actions",
            "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "✅ Confirm & Send"},
                 "style": "primary", "action_id": "confirm_email", "value": str(pending_id)},
                {"type": "button", "text": {"type": "plain_text", "text": "Cancel"},
                 "action_id": "cancel_email", "value": str(pending_id)},
            ],
        },
    ]


async def _propose_email(
    session,
    *,
    conn: Connection,
    channel: str,
    thread_ts: str | None,
    team_id: str,
    slack_user_id: str,
    tenant_id: int | None,
    asked: str,
) -> bool:
    """Draft an email from the message and post a Confirm/Cancel card. Returns
    True if handled (proposed or messaged the user), False if it turned out not
    to be an email request (caller falls back to Q&A)."""
    client = get_llm_client()
    draft = await extract_email(asked, client=client)
    if draft and (draft.get("_in") or draft.get("_out")):
        await record_token_usage(
            session, tenant_id=tenant_id, source="slack",
            model=draft.get("_model"), input_tokens=draft.get("_in"),
            output_tokens=draft.get("_out"),
        )
        await session.commit()
    if not draft:
        return False

    emails, unresolved = await resolve_recipients(session, tenant_id=tenant_id, raw=draft["to"])
    if not emails:
        await _post(
            conn, channel,
            "I couldn't work out a valid recipient. Include an email address — "
            "e.g. _email alice@acme.com about the launch slipping_.",
            thread_ts,
        )
        return True

    pa = PendingAction(
        tenant_id=tenant_id,
        slack_team_id=team_id,
        slack_user_id=slack_user_id,
        kind="send_email",
        payload={"to": emails, "subject": draft["subject"], "body": draft["body"], "unresolved": unresolved},
        status="pending",
    )
    session.add(pa)
    await session.flush()
    pid = pa.id
    await session.commit()
    await _post(
        conn, channel,
        f"Confirm sending this email to {', '.join(emails)}?",
        thread_ts,
        blocks=_email_confirm_blocks(pid, emails, draft["subject"], draft["body"], unresolved),
    )
    return True


async def _dm(conn: Connection, user_id: str, text: str) -> bool:
    """Open the user's IM and post privately. Returns False (logged) if the
    bot can't DM (e.g. missing im:write) so the caller can fall back."""
    try:
        async with SlackClient(connection=conn) as sc:
            channel = await sc.open_im(user_id=user_id)
            if not channel:
                return False
            await sc.post_message(channel=channel, text=text)
            return True
    except Exception as e:  # noqa: BLE001
        log.warning("husn.slack.events.dm_failed", err=str(e)[:200])
        return False


async def _process_event(payload: dict) -> None:
    """Resolve the workspace's bot token; link the user or answer. Loop-safe."""
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
    slack_user_id = event.get("user")
    if not team_id or not channel or not slack_user_id:
        return
    thread_ts = (event.get("thread_ts") or event.get("ts")) if etype == "app_mention" else None
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

        identity = (
            await session.execute(
                select(SlackIdentity).where(
                    SlackIdentity.slack_team_id == str(team_id),
                    SlackIdentity.slack_user_id == str(slack_user_id),
                )
            )
        ).scalar_one_or_none()

        # Unlinked → send a one-time link so the user only ever sees their own
        # workspace's data (per-user access model). ALWAYS DM the link (never
        # post the token in a channel, where someone else could claim it).
        if identity is None:
            token = sign_token(
                {"team": str(team_id), "user": str(slack_user_id)},
                source=LINK_TOKEN_SOURCE,
            )
            link = f"{get_settings().public_web_base_url.rstrip('/')}/slack/link?token={token}"
            dm_text = (
                "👋 I'm Husn. To answer for *you*, link this Slack account to your "
                "Husn login (so you only see what your account can):\n\n"
                f"<{link}|Link your Husn account> — then message me again."
            )
            if event.get("channel_type") == "im":
                # Already in the user's DM — post the link here (private).
                await _post(conn, channel, dm_text, None)
            else:
                # In a channel: DM the token privately (never post it in-channel),
                # and acknowledge publicly without leaking the link.
                delivered = await _dm(conn, slack_user_id, dm_text)
                await _post(
                    conn, channel,
                    "📬 I've sent you a DM to link your Husn account."
                    if delivered
                    else "Open a direct message with me and say hi — I'll send you a link to connect your account.",
                    thread_ts,
                )
            return

        if not asked:
            await _post(
                conn, channel,
                "Ask me about your briefing — e.g. “what are the biggest risks right now?”",
                thread_ts,
            )
            return

        # Confirm-first email action: if it reads like a send-email request,
        # draft it and post Confirm/Cancel buttons instead of answering.
        if looks_like_email_request(asked):
            ctx_token = current_tenant_id.set(identity.tenant_id)
            try:
                handled = await _propose_email(
                    session, conn=conn, channel=channel, thread_ts=thread_ts,
                    team_id=str(team_id), slack_user_id=str(slack_user_id),
                    tenant_id=identity.tenant_id, asked=asked,
                )
            except RateLimitedError:
                handled = True
                await _post(conn, channel, "⏳ The model is rate-limited — try the email again shortly.", thread_ts)
            except Exception:  # noqa: BLE001
                log.exception("husn.slack.email.propose_failed", slack_user_id=slack_user_id)
                handled = True
                await _post(conn, channel, "Sorry — I couldn't draft that email. Try again.", thread_ts)
            finally:
                current_tenant_id.reset(ctx_token)
            if handled:
                return

        # Answer as the linked user, scoped to their tenant + default project.
        ctx_token = current_tenant_id.set(identity.tenant_id)
        try:
            project = await get_or_create_default_project(session, tenant_id=identity.tenant_id)
            result = await run_chat_turn(
                session, project_id=project.id, history=[], user_message=asked
            )
            reply = _format_for_slack(result.get("reply") or "…")
            await record_token_usage(
                session,
                tenant_id=identity.tenant_id,
                source="slack",
                model=result.get("model"),
                input_tokens=result.get("input_tokens"),
                output_tokens=result.get("output_tokens"),
            )
            await session.commit()
        except RateLimitedError:
            reply = (
                "⏳ The model is rate-limited right now (the daily token quota is "
                "used up). Try again a little later — switching sync to Manual in "
                "Settings frees up quota."
            )
        except Exception:  # noqa: BLE001
            log.exception("husn.slack.events.answer_failed", slack_user_id=slack_user_id)
            reply = "Sorry — I hit an error answering that. Try again in a moment."
        finally:
            current_tenant_id.reset(ctx_token)

        await _post(conn, channel, reply, thread_ts)
