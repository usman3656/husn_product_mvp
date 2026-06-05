"""R-DATE-1 — date-claim drift across sources.

Trigger: a single claim_group of kind='date' has more than one distinct
`value_norm` from claims with confidence >= MIN_CONFIDENCE.

Action: upsert an open Finding for (R-DATE-1, claim_group_id). Cite all the
conflicting claims as primary evidence. On reconvergence (drift resolved
because someone updated the source so all values match) → close the finding.

Anti-monitoring guardrail (knowledge.md §6, plan.md cross-cutting): the
finding's summary names *artifacts* and *projects* — never individuals.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Artifact, Claim, ClaimGroup, Project

RULE_ID = "R-DATE-1"
MIN_CONFIDENCE = 0.5  # below this, claims don't count toward drift signal


class RDate1:
    rule_id: str = RULE_ID
    applies_to_kind: str = "date"
    severity: str = "high"
    summary_template: str = "{key} date drift in {project}: {values} (across {sources})"

    def detects(self, group_claims: list[Claim]) -> tuple[bool, list[Claim]]:
        eligible = [
            c for c in group_claims
            if c.confidence >= MIN_CONFIDENCE and c.value_norm is not None
        ]
        distinct = {c.value_norm for c in eligible}
        return (len(distinct) > 1, eligible) if len(distinct) > 1 else (False, [])

    async def build_summary(
        self,
        session: AsyncSession,
        *,
        group: ClaimGroup,
        primary_claims: list[Claim],
    ) -> tuple[str, dict[str, Any]]:
        # Need artifact.source for the "(across jira, slack)" tail; pull in one shot.
        art_ids = [c.source_artifact_id for c in primary_claims]
        arts = (
            await session.execute(select(Artifact).where(Artifact.id.in_(art_ids)))
        ).scalars().all()
        art_by_id = {a.id: a for a in arts}

        project_label = await _project_label(session, group.project_id)
        sources = sorted({art_by_id[c.source_artifact_id].source for c in primary_claims})
        value_list = sorted({c.value_norm for c in primary_claims})
        summary = (
            f"{group.key.capitalize()} date drift in {project_label}: "
            f"{', '.join(value_list)} (across {', '.join(sources)})"
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
                    "value_norm": claim.value_norm,
                    "value": claim.value,
                    "confidence": claim.confidence,
                    "extractor_id": claim.extractor_id,
                    "source_anchor": claim.source_anchor,
                }
            )
        details = {
            "kind": group.kind,
            "key": group.key,
            "distinct_values": value_list,
            "per_source": per_source,
        }
        return summary, details


async def _project_label(session: AsyncSession, project_id: int | None) -> str:
    if project_id is None:
        return "(unassigned)"
    p = await session.get(Project, project_id)
    return p.name if p else f"project #{project_id}"


rule = RDate1()
