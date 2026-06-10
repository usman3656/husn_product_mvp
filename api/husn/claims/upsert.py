"""Idempotent claim upsert."""

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.claims.base import ClaimCandidate
from husn.db.models import Claim


async def upsert_claim(
    session: AsyncSession,
    *,
    source_artifact_id: int,
    project_id: int | None,
    extractor_id: str,
    extractor_version: int,
    candidate: ClaimCandidate,
    tenant_id: int | None = None,
) -> int:
    """tenant_id derives from the source Artifact (TENANCY.md C3); None
    during the AUTH_REQUIRED=0 bridge."""
    stmt = (
        pg_insert(Claim)
        .values(
            tenant_id=tenant_id,
            project_id=project_id,
            source_artifact_id=source_artifact_id,
            kind=candidate.kind,
            key=candidate.key,
            value=candidate.value,
            value_norm=candidate.value_norm,
            confidence=candidate.confidence,
            source_anchor=candidate.source_anchor,
            extractor_id=extractor_id,
            extractor_version=extractor_version,
        )
        .on_conflict_do_update(
            constraint="uq_claim_artifact_kind_key_extractor",
            set_={
                "value": candidate.value,
                "value_norm": candidate.value_norm,
                "confidence": candidate.confidence,
                "source_anchor": candidate.source_anchor,
                "project_id": project_id,
                "tenant_id": tenant_id,
            },
        )
        .returning(Claim.id)
    )
    result = await session.execute(stmt)
    return result.scalar_one()
