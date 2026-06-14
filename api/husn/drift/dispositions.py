"""Finding dispositions — the TPM "this has been dealt with" layer.

A disposition suppresses a drift issue identified by (tenant_id, rule_id,
claim_group_id). The drift evaluator consults it before opening a finding so a
dealt-with issue never re-surfaces — unless the conflicting values change, in
which case the stored value_signature no longer matches and it comes back.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import FindingDisposition


def value_signature(details: dict | None) -> str | None:
    """Stable hash of a finding's conflicting values, so a dealt-with issue
    resurfaces only when the values genuinely change. Returns None when the
    finding carries no distinct_values (then the disposition suppresses
    regardless of value)."""
    if not details:
        return None
    vals = details.get("distinct_values")
    if not vals:
        return None
    canonical = json.dumps(sorted(str(v) for v in vals), separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def get_disposition(
    session: AsyncSession,
    *,
    tenant_id: int | None,
    rule_id: str,
    claim_group_id: int,
) -> FindingDisposition | None:
    stmt = (
        select(FindingDisposition)
        .where(
            FindingDisposition.tenant_id.is_(tenant_id) if tenant_id is None
            else FindingDisposition.tenant_id == tenant_id,
            FindingDisposition.rule_id == rule_id,
            FindingDisposition.claim_group_id == claim_group_id,
        )
        # first() not scalar_one_or_none(): a NULL tenant_id (bridge mode) isn't
        # covered by the unique constraint, so tolerate a rare duplicate rather
        # than raising MultipleResultsFound inside the drift tick.
        .order_by(FindingDisposition.id)
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


async def upsert_disposition(
    session: AsyncSession,
    *,
    tenant_id: int | None,
    rule_id: str,
    claim_group_id: int,
    value_signature: str | None,
    summary: str | None,
    created_by: int | None,
) -> FindingDisposition:
    existing = await get_disposition(
        session, tenant_id=tenant_id, rule_id=rule_id, claim_group_id=claim_group_id
    )
    if existing is not None:
        existing.value_signature = value_signature
        existing.summary = summary
        existing.created_by = created_by
        existing.created_at = datetime.now(UTC)
        return existing
    disp = FindingDisposition(
        tenant_id=tenant_id,
        rule_id=rule_id,
        claim_group_id=claim_group_id,
        value_signature=value_signature,
        summary=summary,
        created_by=created_by,
    )
    session.add(disp)
    await session.flush()
    return disp


async def delete_disposition(
    session: AsyncSession,
    *,
    tenant_id: int | None,
    rule_id: str,
    claim_group_id: int,
) -> None:
    await session.execute(
        delete(FindingDisposition).where(
            FindingDisposition.tenant_id.is_(tenant_id) if tenant_id is None
            else FindingDisposition.tenant_id == tenant_id,
            FindingDisposition.rule_id == rule_id,
            FindingDisposition.claim_group_id == claim_group_id,
        )
    )
