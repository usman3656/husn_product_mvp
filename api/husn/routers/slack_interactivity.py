"""Slack interactivity — Confirm/Cancel buttons for confirm-first actions.

Slack POSTs an application/x-www-form-urlencoded body with a `payload` field
(JSON). We verify the signature (same scheme as /slack/events), ACK within 3s,
and execute in the background. Only the user who requested the action can
confirm it, and only once (atomic status claim).
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlalchemy import text

from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import PendingAction
from husn.db.session import SessionLocal
from husn.email_send import send_email
from husn.routers.slack_events import verify_slack_signature

router = APIRouter(prefix="/slack", tags=["slack"])


async def _update_message(response_url: str, message: str) -> None:
    """Replace the original Confirm/Cancel card with a result message."""
    if not response_url:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(response_url, json={"replace_original": True, "text": message})
    except Exception as e:  # noqa: BLE001
        log.warning("husn.slack.interactivity.update_failed", err=str(e)[:200])


@router.post("/interactivity")
async def slack_interactivity(request: Request, background: BackgroundTasks) -> Any:
    raw = await request.body()
    s = get_settings()
    if not verify_slack_signature(
        headers=request.headers, raw_body=raw, signing_secret=s.slack_signing_secret
    ):
        raise HTTPException(401, "bad slack signature")

    form = parse_qs(raw.decode("utf-8"))
    payload_raw = (form.get("payload") or [""])[0]
    try:
        payload = json.loads(payload_raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "invalid payload")

    if payload.get("type") == "block_actions":
        background.add_task(_handle_action, payload)
    return {"ok": True}


async def _handle_action(payload: dict) -> None:
    actions = payload.get("actions") or []
    if not actions:
        return
    action = actions[0]
    action_id = action.get("action_id")
    value = action.get("value")  # pending_action id
    user_id = (payload.get("user") or {}).get("id")
    team_id = (payload.get("team") or {}).get("id")
    response_url = payload.get("response_url") or ""
    if action_id not in ("confirm_email", "cancel_email") or not value or not user_id:
        return

    try:
        pid = int(value)
    except (TypeError, ValueError):
        return

    new_status = "confirmed" if action_id == "confirm_email" else "cancelled"

    async with SessionLocal() as session:
        # Atomically claim the action — only if still pending AND it belongs to
        # the clicking user. Prevents double-send and cross-user confirmation.
        claimed = (
            await session.execute(
                text(
                    "UPDATE pending_actions SET status = :ns "
                    "WHERE id = :id AND status = 'pending' "
                    "AND slack_user_id = :u AND slack_team_id = :t "
                    "RETURNING id"
                ),
                {"ns": new_status, "id": pid, "u": str(user_id), "t": str(team_id)},
            )
        ).first()
        await session.commit()

        if claimed is None:
            await _update_message(response_url, "This action is no longer available (already handled or not yours).")
            return

        if new_status == "cancelled":
            await _update_message(response_url, "✖ Cancelled — no email sent.")
            return

        pa = await session.get(PendingAction, pid)
        payload_data = (pa.payload or {}) if pa else {}

    # We claim (pending→confirmed) BEFORE sending so a crash mid-send can't be
    # retried into a double-send. The trade-off: if the provider send fails, the
    # row stays 'confirmed' and isn't auto-retried — the user re-issues the
    # request. Recipients come from the DB row, never the button payload.
    to = payload_data.get("to") or []
    subject = payload_data.get("subject") or ""
    body = payload_data.get("body") or ""
    ok = await send_email(to=to, subject=subject, body=body)
    if ok:
        await _update_message(response_url, f"✅ Email sent to {', '.join(to)}.")
    else:
        await _update_message(response_url, "⚠️ Couldn't send the email (mail provider error). Nothing was sent.")
        log.warning("husn.slack.interactivity.email_failed", pending_id=pid)
