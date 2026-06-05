"""Run all applicable extractors over artifacts that haven't been extracted yet.

An artifact is "pending" when:
  artifacts.claims_extracted_at IS NULL
  OR artifacts.claims_extractor_version < CURRENT_EXTRACTOR_VERSION

The latter case lets us bump CURRENT_EXTRACTOR_VERSION to force re-extraction
across the corpus when extractor logic changes meaningfully.
"""

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.claims.base import Extractor
from husn.claims.extractors.commitment import SlackCommitmentExtractor
from husn.claims.extractors.date import JiraDateExtractor, SlackDateExtractor
from husn.claims.extractors.decision import SlackDecisionExtractor
from husn.claims.extractors.dependency import (
    JiraDependencyExtractor,
    SlackDependencyExtractor,
)
from husn.claims.extractors.owner import JiraOwnerExtractor, SlackAuthorExtractor
from husn.claims.extractors.scope import SlackScopeExtractor
from husn.claims.extractors.status import JiraStatusExtractor, SlackStatusExtractor
from husn.claims.upsert import upsert_claim
from husn.core.logging import log
from husn.db.models import Artifact, RawArtifact

# Bump this when adding/changing extractors to force re-extraction.
CURRENT_EXTRACTOR_VERSION = 1

_ALL_EXTRACTORS: list[Extractor] = [
    JiraOwnerExtractor(),
    JiraStatusExtractor(),
    JiraDateExtractor(),
    JiraDependencyExtractor(),
    SlackAuthorExtractor(),
    SlackStatusExtractor(),
    SlackDateExtractor(),
    SlackDecisionExtractor(),
    SlackScopeExtractor(),
    SlackDependencyExtractor(),
    SlackCommitmentExtractor(),
]


def _extractors_for(source: str, kind: str) -> list[Extractor]:
    return [e for e in _ALL_EXTRACTORS if (source, kind) in e.kinds]


async def extract_pending(session: AsyncSession, batch_size: int = 200) -> dict[str, int]:
    stmt = (
        select(Artifact, RawArtifact)
        .join(RawArtifact, Artifact.raw_artifact_id == RawArtifact.id)
        .where(
            or_(
                Artifact.claims_extracted_at.is_(None),
                Artifact.claims_extractor_version < CURRENT_EXTRACTOR_VERSION,
            )
        )
        .order_by(Artifact.normalized_at.asc())
        .limit(batch_size)
    )
    rows = (await session.execute(stmt)).all()

    counts = {"considered": len(rows), "extracted_claims": 0, "artifacts_done": 0}
    for artifact, raw in rows:
        extractors = _extractors_for(artifact.source, artifact.kind)
        for ext in extractors:
            try:
                cands = ext.extract(artifact_row=artifact, raw_payload=raw.payload or {})
            except Exception:
                log.exception(
                    "husn.claims.extractor.failed",
                    extractor=ext.id,
                    artifact_id=artifact.id,
                )
                continue
            for c in cands:
                await upsert_claim(
                    session,
                    source_artifact_id=artifact.id,
                    project_id=artifact.project_id,
                    extractor_id=ext.id,
                    extractor_version=ext.version,
                    candidate=c,
                )
                counts["extracted_claims"] += 1
        artifact.claims_extracted_at = datetime.now(UTC)
        artifact.claims_extractor_version = CURRENT_EXTRACTOR_VERSION
        counts["artifacts_done"] += 1

    await session.commit()
    if counts["considered"] or counts["extracted_claims"]:
        log.info("husn.claims.extract.batch", **counts)
    return counts
