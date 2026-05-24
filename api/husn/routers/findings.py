"""Findings (drift) read endpoints."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Claim, ClaimGroup, Finding, FindingEvidence
from husn.db.session import get_session

router = APIRouter(prefix="/api/findings", tags=["findings"])


@router.get("/summary")
async def summary(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    open_count = (
        await session.execute(select(func.count(Finding.id)).where(Finding.status == "open"))
    ).scalar_one()
    closed_count = (
        await session.execute(select(func.count(Finding.id)).where(Finding.status == "closed"))
    ).scalar_one()
    by_rule = (
        await session.execute(
            select(Finding.rule_id, func.count(Finding.id))
            .where(Finding.status == "open")
            .group_by(Finding.rule_id)
        )
    ).all()
    last_open = (
        await session.execute(
            select(func.max(Finding.opened_at)).where(Finding.status == "open")
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
) -> dict[str, Any]:
    stmt = select(Finding).order_by(desc(Finding.opened_at)).limit(limit)
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


@router.get("/{finding_id}")
async def get_finding(
    finding_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    f = await session.get(Finding, finding_id)
    if not f:
        raise HTTPException(404, "finding not found")
    group = await session.get(ClaimGroup, f.claim_group_id)
    evidence_rows = (
        await session.execute(
            select(Claim, FindingEvidence)
            .join(FindingEvidence, FindingEvidence.claim_id == Claim.id)
            .where(FindingEvidence.finding_id == f.id)
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
