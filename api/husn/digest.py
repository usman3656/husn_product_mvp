"""Daily admin digest — a morning email of what needs attention.

In Husn there is no separate "task" table: open Findings ARE the pending
tasks / drifts / issues a TPM acts on. This module gathers each workspace's
open findings, groups them by severity, and emails the workspace's owners and
admins. It's driven by the worker cron (husn.workers.daily_digest), once a day.

Resolved (dealt-with → snoozed) findings are intentionally excluded: they don't
count against confidence and shouldn't reappear in the morning email — they
live in the Resolved folder until recalled.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Finding, Membership, Tenant, User
from husn.email_send import send_email

_SEV_LABEL = {"high": "High priority", "medium": "Needs attention", "low": "Low priority"}
_SEV_ORDER = ("high", "medium", "low")


async def _open_findings(session: AsyncSession, tenant_id: int) -> list[Finding]:
    rows = (
        await session.execute(
            select(Finding)
            .where(Finding.tenant_id == tenant_id, Finding.status == "open")
            .order_by(desc(Finding.opened_at))
        )
    ).scalars().all()
    return list(rows)


async def _admin_emails(session: AsyncSession, tenant_id: int) -> list[str]:
    """Owners + admins who have logged in (active). De-duped, original casing."""
    rows = (
        await session.execute(
            select(Membership.email).where(
                Membership.tenant_id == tenant_id,
                Membership.role.in_(("owner", "admin")),
                Membership.status == "active",
            )
        )
    ).scalars().all()
    seen: set[str] = set()
    out: list[str] = []
    for e in rows:
        key = (e or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(e.strip())
    return out


def _build_body(tenant_name: str, findings: list[Finding]) -> str:
    web = get_settings().public_web_base_url.rstrip("/")
    if not findings:
        return (
            f"Good morning.\n\n"
            f"{tenant_name}: nothing needs your attention right now — no open "
            f"drifts or issues across your connected sources.\n\n"
            f"Open your briefing: {web}/"
        )

    by_sev: dict[str, list[Finding]] = {s: [] for s in _SEV_ORDER}
    for f in findings:
        by_sev.get(f.severity, by_sev["medium"]).append(f)

    n = len(findings)
    lines = [
        "Good morning.",
        "",
        f"{tenant_name} has {n} open {'issue' if n == 1 else 'issues'} that "
        f"need attention this morning:",
        "",
    ]
    for sev in _SEV_ORDER:
        items = by_sev[sev]
        if not items:
            continue
        lines.append(f"{_SEV_LABEL[sev]} ({len(items)})")
        for f in items:
            lines.append(f"  • {f.summary}")
        lines.append("")
    lines.append(f"Open the briefing to act on these: {web}/")
    return "\n".join(lines)


async def send_daily_digests(session: AsyncSession) -> dict[str, Any]:
    """Build and send the morning digest to every workspace's owners/admins.

    One email per recipient (recipients aren't disclosed to each other).
    send_email never raises, so one bad address can't abort the run. Returns a
    summary for the worker log.
    """
    tenants = (await session.execute(select(Tenant))).scalars().all()
    sent = 0
    no_admins = 0
    for t in tenants:
        recipients = await _admin_emails(session, t.id)
        if not recipients:
            no_admins += 1
            continue
        findings = await _open_findings(session, t.id)
        n = len(findings)
        subject = (
            f"Husn morning briefing — {n} open {'issue' if n == 1 else 'issues'}"
            if n
            else "Husn morning briefing — all clear"
        )
        body = _build_body(t.name, findings)
        for email in recipients:
            if await send_email(to=[email], subject=subject, body=body):
                sent += 1
    summary = {
        "tenants": len(tenants),
        "emails_sent": sent,
        "tenants_without_admins": no_admins,
    }
    log.info("husn.digest.sent", **summary)
    return summary
