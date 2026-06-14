"""Findings (drift) read endpoints + TPM disposition ("dealt with")."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_member
from husn.auth.scope import tenant_where
from husn.db.models import Claim, ClaimGroup, Finding, FindingEvidence
from husn.db.session import get_session
from husn.drift.dispositions import (
    delete_disposition,
    upsert_disposition,
    value_signature,
)

router = APIRouter(prefix="/api/findings", tags=["findings"])


@router.get("/summary")
async def summary(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    open_count = (
        await session.execute(
            tenant_where(
                select(func.count(Finding.id)).where(Finding.status == "open"), Finding, ctx
            )
        )
    ).scalar_one()
    closed_count = (
        await session.execute(
            tenant_where(
                select(func.count(Finding.id)).where(Finding.status == "closed"), Finding, ctx
            )
        )
    ).scalar_one()
    by_rule = (
        await session.execute(
            tenant_where(
                select(Finding.rule_id, func.count(Finding.id))
                .where(Finding.status == "open")
                .group_by(Finding.rule_id),
                Finding,
                ctx,
            )
        )
    ).all()
    last_open = (
        await session.execute(
            tenant_where(
                select(func.max(Finding.opened_at)).where(Finding.status == "open"),
                Finding,
                ctx,
            )
        )
    ).scalar()
    return {
        "open": open_count,
        "closed": closed_count,
        "open_by_rule": {r: c for r, c in by_rule},
        "last_open_at": last_open.isoformat() if last_open else None,
    }


@router.get("")
async def list_findings(
    status: str = Query("open", pattern="^(open|closed|all)$"),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    stmt = tenant_where(select(Finding).order_by(desc(Finding.opened_at)).limit(limit), Finding, ctx)
    if status != "all":
        stmt = stmt.where(Finding.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": f.id,
                "rule_id": f.rule_id,
                "status": f.status,
                "severity": f.severity,
                "summary": f.summary,
                "details": f.details,
                "opened_at": f.opened_at.isoformat(),
                "closed_at": f.closed_at.isoformat() if f.closed_at else None,
            }
            for f in rows
        ],
    }


async def _load_owned_finding(
    finding_id: int, session: AsyncSession, ctx: AuthContext
) -> Finding:
    f = await session.get(Finding, finding_id)
    if not f or (ctx.tenant_id is not None and f.tenant_id != ctx.tenant_id):
        raise HTTPException(404, "finding not found")
    return f


@router.post("/{finding_id}/dealt-with")
async def mark_dealt_with(
    finding_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """TPM marks an issue as handled. It's suppressed everywhere immediately
    (status → snoozed) and a disposition keyed on the stable issue identity
    keeps it from re-surfacing on the next drift tick — unless the conflicting
    values change, in which case it comes back."""
    f = await _load_owned_finding(finding_id, session, ctx)
    if f.claim_group_id is None:
        raise HTTPException(400, "this finding can't be marked dealt with")

    await upsert_disposition(
        session,
        tenant_id=f.tenant_id,
        rule_id=f.rule_id,
        claim_group_id=f.claim_group_id,
        value_signature=value_signature(f.details),
        summary=f.summary,
        created_by=ctx.user_id,
    )
    f.status = "snoozed"
    f.updated_at = datetime.now(UTC)
    await session.commit()
    return {"status": "ok", "finding_id": f.id}


@router.post("/{finding_id}/reopen")
async def reopen_finding(
    finding_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Undo a 'dealt with': clear the disposition so the issue can surface
    again. Reopens this row only if no newer open finding already covers the
    same issue (the partial unique index allows just one open per identity)."""
    f = await _load_owned_finding(finding_id, session, ctx)
    if f.claim_group_id is not None:
        await delete_disposition(
            session,
            tenant_id=f.tenant_id,
            rule_id=f.rule_id,
            claim_group_id=f.claim_group_id,
        )
        dup = (
            await session.execute(
                select(Finding.id).where(
                    Finding.rule_id == f.rule_id,
                    Finding.claim_group_id == f.claim_group_id,
                    Finding.status == "open",
                    Finding.id != f.id,
                )
            )
        ).scalar_one_or_none()
        if dup is None:
            f.status = "open"
            f.closed_at = None
            f.updated_at = datetime.now(UTC)
    await session.commit()
    return {"status": "ok", "finding_id": f.id}


@router.get("/{finding_id}")
async def get_finding(
    finding_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    f = await session.get(Finding, finding_id)
    if not f:
        raise HTTPException(404, "finding not found")
    if ctx.tenant_id is not None and f.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "finding not found")
    group = await session.get(ClaimGroup, f.claim_group_id)
    evidence_rows = (
        await session.execute(
            tenant_where(
                select(Claim, FindingEvidence)
                .join(FindingEvidence, FindingEvidence.claim_id == Claim.id)
                .where(FindingEvidence.finding_id == f.id),
                Claim,
                ctx,
            )
        )
    ).all()
    return {
        "id": f.id,
        "rule_id": f.rule_id,
        "status": f.status,
        "severity": f.severity,
        "summary": f.summary,
        "details": f.details,
        "opened_at": f.opened_at.isoformat(),
        "closed_at": f.closed_at.isoformat() if f.closed_at else None,
        "claim_group": (
            {"id": group.id, "kind": group.kind, "key": group.key, "project_id": group.project_id}
            if group
            else None
        ),
        "evidence": [
            {
                "role": ev.role,
                "claim_id": claim.id,
                "kind": claim.kind,
                "key": claim.key,
                "value_norm": claim.value_norm,
                "value": claim.value,
                "confidence": claim.confidence,
                "extractor_id": claim.extractor_id,
                "source_anchor": claim.source_anchor,
            }
            for claim, ev in evidence_rows
        ],
    }
