"""Detect + extract an email-send request from a Slack message.

Detection is a cheap keyword check (so normal Q&A never spends an extra LLM
call); extraction is one focused LLM call returning structured JSON. Recipients
are resolved to email addresses (literal emails, or names matched against the
person directory).
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.agent.llm import parse_json_response
from husn.core.logging import log
from husn.db.models import Person

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_TRIGGER_RE = re.compile(
    r"\b(send|draft|write|compose|shoot|fire off)\b[^.]{0,40}\bemail\b"
    r"|\bemail\b[^.]{0,20}@",
    re.IGNORECASE,
)

_EXTRACT_SYSTEM = (
    "You extract an email-send request from a message. Return ONLY JSON of the "
    'form {"to": ["email or name", ...], "subject": "...", "body": "..."}.\n'
    "- to: each recipient as an email address if the message contains one, else "
    "the person's name.\n"
    "- subject: a concise subject line.\n"
    "- body: a complete, polite plain-text email body. Write it in full; never "
    "leave placeholders like [name].\n"
    'If the message is not actually asking to send an email, return {"to": [], '
    '"subject": "", "body": ""}.'
)


def looks_like_email_request(text: str) -> bool:
    return bool(_TRIGGER_RE.search(text or ""))


async def extract_email(text: str, *, client: Any) -> dict | None:
    """One LLM call → {to, subject, body, _in, _out, _model}. Returns None when
    the model decides it isn't an email request. Re-raises provider errors
    (e.g. RateLimitedError) so the caller can message the user appropriately."""
    result = await client.complete(system=_EXTRACT_SYSTEM, user=text, json_mode=True)
    try:
        data = parse_json_response(result.text)
    except Exception as e:  # noqa: BLE001
        log.warning("husn.email.extract_parse_failed", err=str(e)[:200])
        return None
    to = data.get("to")
    if not isinstance(to, list) or not to:
        return None
    return {
        "to": [str(t) for t in to],
        "subject": str(data.get("subject") or ""),
        "body": str(data.get("body") or ""),
        "_in": result.input_tokens,
        "_out": result.output_tokens,
        "_model": getattr(client, "model", None),
    }


async def resolve_recipients(
    session: AsyncSession, *, tenant_id: int | None, raw: list[str]
) -> tuple[list[str], list[str]]:
    """Split raw recipients into resolved email addresses + unresolved names.
    Literal emails pass through; names are matched (case-insensitive) against
    the tenant's person directory's primary_email."""
    emails: list[str] = []
    unresolved: list[str] = []
    for token in raw:
        token = (token or "").strip()
        if not token:
            continue
        m = _EMAIL_RE.search(token)
        if m:
            emails.append(m.group(0))
            continue
        # Name → email from the directory. Try an exact (case-insensitive)
        # match first, then a partial one ("John" → "John Smith"), preferring
        # exact so common first names don't grab the wrong person.
        base = select(Person.primary_email).where(Person.primary_email.isnot(None))
        if tenant_id is not None:
            base = base.where(Person.tenant_id == tenant_id)
        email = (
            await session.execute(
                base.where(func.lower(Person.primary_name) == token.lower()).limit(1)
            )
        ).scalar_one_or_none()
        if not email:
            email = (
                await session.execute(
                    base.where(Person.primary_name.ilike(f"%{token}%"))
                    .order_by(func.length(Person.primary_name))
                    .limit(1)
                )
            ).scalar_one_or_none()
        if email:
            emails.append(email)
        else:
            unresolved.append(token)

    seen: set[str] = set()
    deduped: list[str] = []
    for e in emails:
        if e.lower() not in seen:
            seen.add(e.lower())
            deduped.append(e)
    return deduped, unresolved
