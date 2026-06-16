"""Detect + resolve a "mark this issue dealt with" request from a Slack message.

Keyword gate (so normal Q&A spends no extra LLM call), then one focused LLM
call to pick WHICH open finding the user means from the current list.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.agent.llm import parse_json_response
from husn.db.models import Finding

_TRIGGER_RE = re.compile(
    r"\b(dealt?\s+with|mark[^.]{0,30}\b(done|resolved|handled|dealt)\b"
    r"|close[^.]{0,30}\b(issue|risk|finding|drift|conflict)\b"
    r"|dismiss\b|resolve[d]?\s+(the|this|that))",
    re.IGNORECASE,
)

_SELECT_SYSTEM = (
    "You match a user's request to ONE open issue. Given the numbered open "
    "issues and the request, return ONLY JSON {\"id\": <the issue id the user "
    "means, or null if none clearly match>}."
)


def looks_like_dealt_with(text: str) -> bool:
    return bool(_TRIGGER_RE.search(text or ""))


async def open_findings(
    session: AsyncSession, *, tenant_id: int | None, limit: int = 30
) -> list[Finding]:
    q = select(Finding).where(Finding.status == "open")
    if tenant_id is not None:
        q = q.where(Finding.tenant_id == tenant_id)
    return list(
        (await session.execute(q.order_by(desc(Finding.opened_at)).limit(limit))).scalars().all()
    )


async def select_finding(
    text: str, *, findings: list[Finding], client: Any
) -> tuple[int | None, dict]:
    """LLM-pick the finding the user means. Returns (finding_id|None, tokens).
    finding_id is validated to be one of the supplied open findings."""
    listing = "\n".join(f"{f.id}: {f.summary}" for f in findings)
    user = f"OPEN ISSUES:\n{listing}\n\nUSER REQUEST:\n{text}"
    result = await client.complete(system=_SELECT_SYSTEM, user=user, json_mode=True)
    tokens = {
        "_in": result.input_tokens,
        "_out": result.output_tokens,
        "_model": getattr(client, "model", None),
    }
    try:
        data = parse_json_response(result.text)
        fid = data.get("id")
        fid = int(fid) if fid is not None else None
    except Exception:  # noqa: BLE001
        fid = None
    if fid not in {f.id for f in findings}:
        fid = None
    return fid, tokens
