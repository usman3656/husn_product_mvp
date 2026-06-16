"""Slack interactivity — Confirm/Cancel buttons for confirm-first actions.

Slack POSTs an application/x-www-form-urlencoded body with a `payload` field
(JSON). We verify the signature (same scheme as /slack/events), ACK within 3s,
and execute in the background. Only the user who requested the action can
confirm it, and only once (atomic status claim).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlalchemy import text

from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Finding, PendingAction
from husn.db.session import SessionLocal
from husn.drift.dispositions import upsert_disposition, value_signature
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
    confirm_ids = {"confirm_email", "confirm_dealt_with"}
    cancel_ids = {"cancel_email", "cancel_dealt_with"}
    if action_id not in (confirm_ids | cancel_ids) or not value or not user_id:
        return

    try:
        pid = int(value)
    except (TypeError, ValueError):
        return

    is_cancel = action_id in cancel_ids
    new_status = "cancelled" if is_cancel else "confirmed"

    async with SessionLocal() as session:
        # Atomically claim the action — only if still pending AND it belongs to
        # the clicking user. Prevents double-execution and cross-user confirm.
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

        pa = await session.get(PendingAction, pid)
        kind = pa.kind if pa else None
        payload_data = (pa.payload or {}) if pa else {}

    if is_cancel:
        await _update_message(response_url, "✖ Cancelled.")
        return

    # We claim (pending→confirmed) BEFORE acting so a crash mid-action can't be
    # retried into a double-execution. Data comes from the DB row, never the
    # button payload.
    if kind == "send_email":
        to = payload_data.get("to") or []
        subject = payload_data.get("subject") or ""
        body = payload_data.get("body") or ""
        ok = await send_email(to=to, subject=subject, body=body)
        if ok:
            await _update_message(response_url, f"✅ Email sent to {', '.join(to)}.")
        else:
            await _update_message(response_url, "⚠️ Couldn't send the email (mail provider error). Nothing was sent.")
            log.warning("husn.slack.interactivity.email_failed", pending_id=pid)
    elif kind == "mark_dealt_with":
        await _do_mark_dealt_with(payload_data, response_url)
    else:
        await _update_message(response_url, "Done.")


async def _do_mark_dealt_with(payload_data: dict, response_url: str) -> None:
    """Snooze the finding + record the TPM disposition (so it won't resurface
    unless the conflict changes) — the same effect as the dashboard button."""
    fid = payload_data.get("finding_id")
    summary = payload_data.get("summary") or "issue"
    created_by = payload_data.get("created_by")
    if not fid:
        await _update_message(response_url, "⚠️ Couldn't find that issue.")
        return
    async with SessionLocal() as session:
        f = await session.get(Finding, int(fid))
        if f is None:
            await _update_message(response_url, "⚠️ That issue no longer exists.")
            return
        if f.claim_group_id is not None:
            await upsert_disposition(
                session,
                tenant_id=f.tenant_id,
                rule_id=f.rule_id,
                claim_group_id=f.claim_group_id,
                value_signature=value_signature(f.details),
                summary=f.summary,
                created_by=created_by,
            )
        f.status = "snoozed"
        f.updated_at = datetime.now(UTC)
        await session.commit()
    await _update_message(response_url, f"✅ Marked “{summary[:120]}” as dealt with — it won't surface again.")
