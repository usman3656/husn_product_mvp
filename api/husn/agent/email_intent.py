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
from husn.db.models import DirectoryContact

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_TRIGGER_RE = re.compile(
    # "send/draft/… an email …"
    r"\b(send|draft|write|compose|shoot|fire off|drop|send out|forward)\b[^.?!]{0,40}\be-?mail\b"
    # "email <recipient> to/about/the/him/… " (email used as an imperative verb)
    r"|\bemail\b[^.?!]{0,40}\b(to|about|regarding|saying|with|the|him|her|them|everyone|@)"
    # message that starts with an email command
    r"|^\s*(can you |could you |please |pls |hey,? )?e-?mail\b",
    re.IGNORECASE,
)

_EXTRACT_SYSTEM = (
    "You write the email the user is asking to send, USING THE CONVERSATION "
    'CONTEXT. Return ONLY JSON {"to": ["email or name", ...], "subject": "...", '
    '"body": "..."}.\n'
    "- to: each recipient as an email address if present, else the person's name.\n"
    "- subject: a SPECIFIC subject about the actual topic. Never 'Message from "
    "User' or similar.\n"
    "- body: a complete, specific email about WHAT THE USER IS REFERRING TO. When "
    "they say 'this', 'the issue', 'it', 'that', resolve it from the conversation "
    "and include the real details (names, dates, issue ids, the actual situation). "
    "NEVER write generic filler like 'you have been asked to receive an email'.\n"
    "FORMAT the body like a normal email a person would send:\n"
    "  * Start with a short greeting line (e.g. 'Hi Usman,').\n"
    "  * Use real line breaks: put a blank line between paragraphs, and put each "
    "list item on its own line starting with '- '.\n"
    "  * Sign off as Husn (e.g. end with 'Best,' on one line then 'Husn' on the "
    "next). NEVER sign as 'AI Assistant', '[AI Assistant]', or any bracketed "
    "placeholder.\n"
    "  * Do NOT use em dashes or en dashes (— –). Use commas, periods, or simple "
    "hyphens.\n"
    'If it is not actually an email request, return {"to": [], "subject": "", '
    '"body": ""}.'
)


def looks_like_email_request(text: str) -> bool:
    return bool(_TRIGGER_RE.search(text or ""))


async def extract_email(
    text: str, *, client: Any, history: list[dict[str, str]] | None = None
) -> dict | None:
    """One LLM call → {to, subject, body, _in, _out, _model}. `history` is the
    recent Slack conversation so references like "email this" resolve to what was
    just discussed. Returns None when it isn't an email request. Re-raises
    provider errors (e.g. RateLimitedError) so the caller can message the user."""
    convo = ""
    if history:
        lines = "\n".join(
            f"{m.get('role', 'user')}: {m.get('content', '')}" for m in history[-8:]
        )
        convo = (
            "CONVERSATION SO FAR (use this to resolve 'this' / 'the issue' / 'it'):\n"
            f"{lines}\n\n"
        )
    user = f"{convo}EMAIL REQUEST FROM USER: {text}"
    result = await client.complete(system=_EXTRACT_SYSTEM, user=user, json_mode=True)
    try:
        data = parse_json_response(result.text)
    except Exception as e:  # noqa: BLE001
        log.warning("husn.email.extract_parse_failed", err=str(e)[:200])
        return None
    to = data.get("to")
    if not isinstance(to, list) or not to:
        return None

    def _clean(s: Any) -> str:
        # Guarantee no em/en dashes even if the model ignores the instruction.
        return str(s or "").replace("—", "-").replace("–", "-")

    return {
        "to": [str(t) for t in to],
        "subject": _clean(data.get("subject")),
        "body": _clean(data.get("body")),
        "_in": result.input_tokens,
        "_out": result.output_tokens,
        "_model": getattr(client, "model", None),
    }


async def resolve_recipients(
    session: AsyncSession, *, tenant_id: int | None, raw: list[str]
) -> tuple[list[str], list[str]]:
    """Split raw recipients into resolved email addresses + unresolved names.
    Literal emails pass through; names are matched (case-insensitive) against
    the curated team directory (DirectoryContact)."""
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
        # Name → email from the CURATED team directory. Exact (case-insensitive)
        # match first, then partial ("John" → "John Smith", shortest name wins).
        base = select(DirectoryContact.email).where(DirectoryContact.email.isnot(None))
        if tenant_id is not None:
            base = base.where(DirectoryContact.tenant_id == tenant_id)
        email = (
            await session.execute(
                base.where(func.lower(DirectoryContact.name) == token.lower()).limit(1)
            )
        ).scalar_one_or_none()
        if not email:
            email = (
                await session.execute(
                    base.where(DirectoryContact.name.ilike(f"%{token}%"))
                    .order_by(func.length(DirectoryContact.name))
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


async def team_roster(session: AsyncSession, *, tenant_id: int | None, limit: int = 60) -> str:
    """A compact 'name <email>' roster of the curated directory, to inject into
    the bot's context so it knows the team's emails. Empty string if none."""
    q = select(DirectoryContact.name, DirectoryContact.email).where(
        DirectoryContact.email.isnot(None)
    )
    if tenant_id is not None:
        q = q.where(DirectoryContact.tenant_id == tenant_id)
    rows = (await session.execute(q.order_by(DirectoryContact.name).limit(limit))).all()
    return "; ".join(f"{n} <{e}>" for n, e in rows)
