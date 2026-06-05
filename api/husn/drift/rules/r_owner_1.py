"""R-OWNER-1 — owner-claim drift across sources.

Trigger: a single claim_group of kind='owner' has more than one distinct
resolved owner identifier (Claim.value_norm; falls back to Claim.value when
the extractor hasn't normalized — see owner extractor docs).

Owners drift when e.g. the Jira assignee is one person but the Slack channel
author flagged as DRI is another. We surface the *artifacts*, not the humans
(anti-monitoring guardrail per knowledge.md §6).
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Artifact, Claim, ClaimGroup

RULE_ID = "R-OWNER-1"


def _owner_id(c: Claim) -> str | None:
    """Source-of-truth identifier for an owner claim."""
    return c.value_norm or c.value


class ROwner1:
    rule_id: str = RULE_ID
    applies_to_kind: str = "owner"
    severity: str = "medium"
    summary_template: str = "Owner drift in {kind}/{key}: {n} distinct owners across {sources}"

    def detects(self, group_claims: list[Claim]) -> tuple[bool, list[Claim]]:
        eligible = [c for c in group_claims if _owner_id(c) is not None]
        distinct = {_owner_id(c) for c in eligible}
        return (len(distinct) > 1, eligible) if len(distinct) > 1 else (False, [])

    async def build_summary(
        self,
        session: AsyncSession,
        *,
        group: ClaimGroup,
        primary_claims: list[Claim],
    ) -> tuple[str, dict[str, Any]]:
        art_ids = [c.source_artifact_id for c in primary_claims]
        arts = (
            await session.execute(select(Artifact).where(Artifact.id.in_(art_ids)))
        ).scalars().all()
        art_by_id = {a.id: a for a in arts}

        distinct_owners = sorted({_owner_id(c) for c in primary_claims if _owner_id(c)})
        sources = sorted({art_by_id[c.source_artifact_id].source for c in primary_claims})
        sources_csv = ", ".join(sources)
        summary = (
            f"Owner drift in {group.kind}/{group.key}: "
            f"{len(distinct_owners)} distinct owners across {sources_csv}."
        )

        per_source: dict[str, list[dict[str, Any]]] = {}
        for claim in primary_claims:
            artifact = art_by_id[claim.source_artifact_id]
            per_source.setdefault(artifact.source, []).append(
                {
                    "claim_id": claim.id,
                    "artifact_id": artifact.id,
                    "artifact_kind": artifact.kind,
                    "artifact_title": artifact.title,
                    "owner_id": _owner_id(claim),
                    "value": claim.value,
                    "value_norm": claim.value_norm,
                    "confidence": claim.confidence,
                    "extractor_id": claim.extractor_id,
                    "source_anchor": claim.source_anchor,
                }
            )
        details = {
            "kind": group.kind,
            "key": group.key,
            "distinct_owners": distinct_owners,
            "per_source": per_source,
        }
        return summary, details


rule = ROwner1()
