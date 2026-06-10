"""Claims read endpoints."""

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_member
from husn.auth.scope import tenant_where
from husn.db.models import Artifact, Claim
from husn.db.session import get_session

router = APIRouter(prefix="/api/claims", tags=["claims"])


@router.get("/summary")
async def summary(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Counts per kind for the graph card."""
    by_kind = await session.execute(
        tenant_where(select(Claim.kind, func.count(Claim.id)).group_by(Claim.kind), Claim, ctx)
    )
    counts = {k: c for k, c in by_kind.all()}
    total = await session.execute(tenant_where(select(func.count(Claim.id)), Claim, ctx))
    pending = await session.execute(
        tenant_where(
            select(func.count(Artifact.id)).where(Artifact.claims_extracted_at.is_(None)),
            Artifact,
            ctx,
        )
    )
    last_extracted = (
        await session.execute(tenant_where(select(func.max(Claim.extracted_at)), Claim, ctx))
    ).scalar()
    return {
        "total": total.scalar_one(),
        "pending_artifacts": pending.scalar_one(),
        "by_kind": counts,
        "last_extracted_at": last_extracted.isoformat() if last_extracted else None,
    }


@router.get("")
async def list_claims(
    project_id: int | None = Query(None),
    kind: str | None = Query(None),
    source: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    stmt = (
        select(Claim, Artifact)
        .join(Artifact, Artifact.id == Claim.source_artifact_id)
        .order_by(desc(Claim.extracted_at))
        .limit(limit)
    )
    stmt = tenant_where(stmt, Claim, ctx)
    if project_id is not None:
        stmt = stmt.where(Claim.project_id == project_id)
    if kind:
        stmt = stmt.where(Claim.kind == kind)
    if source:
        stmt = stmt.where(Artifact.source == source)

    rows = (await session.execute(stmt)).all()
    out = []
    for claim, artifact in rows:
        out.append(
            {
                "id": claim.id,
                "kind": claim.kind,
                "key": claim.key,
                "value": claim.value,
                "value_norm": claim.value_norm,
                "confidence": claim.confidence,
                "extractor_id": claim.extractor_id,
                "extracted_at": claim.extracted_at.isoformat(),
                "source_anchor": claim.source_anchor,
                "artifact": {
                    "id": artifact.id,
                    "source": artifact.source,
                    "kind": artifact.kind,
                    "title": artifact.title,
                    "body": artifact.body,
                    "url": artifact.url,
                    "occurred_at": artifact.occurred_at.isoformat() if artifact.occurred_at else None,
                    "external_id": artifact.external_id,
                },
            }
        )
    return {"count": len(out), "items": out}
