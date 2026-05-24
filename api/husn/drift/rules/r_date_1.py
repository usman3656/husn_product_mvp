"""R-DATE-1 — date-claim drift across sources.

Trigger: a single claim_group of kind='date' has more than one distinct
`value_norm` from claims with confidence >= MIN_CONFIDENCE.

Action: upsert an open Finding for (R-DATE-1, claim_group_id). Cite all the
conflicting claims as primary evidence. On reconvergence (drift resolved
because someone updated the source so all values match) → close the finding.

Anti-monitoring guardrail (knowledge.md §6, plan.md cross-cutting): the
finding's summary names *artifacts* and *projects* — never individuals.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import (
    Artifact,
    Claim,
    ClaimGroup,
    ClaimGroupMember,
    Finding,
    FindingEvidence,
    Project,
)

RULE_ID = "R-DATE-1"
MIN_CONFIDENCE = 0.5  # below this, claims don't count toward drift signal


async def evaluate(session: AsyncSession) -> dict[str, int]:
    """Walk every date claim_group; open or close findings as needed."""
    groups = (
        await session.execute(select(ClaimGroup).where(ClaimGroup.kind == "date"))
    ).scalars().all()

    opened = 0
    closed = 0
    in_sync = 0

    for grp in groups:
        # Pull all current claims in this group at or above min confidence
        rows = (
            await session.execute(
                select(Claim, Artifact)
                .join(ClaimGroupMember, ClaimGroupMember.claim_id == Claim.id)
                .join(Artifact, Artifact.id == Claim.source_artifact_id)
                .where(
                    ClaimGroupMember.claim_group_id == grp.id,
                    Claim.confidence >= MIN_CONFIDENCE,
                    Claim.value_norm.isnot(None),
                )
            )
        ).all()
        if not rows:
            continue

        # Distinct date values currently active in the group
        distinct_values = {claim.value_norm for claim, _ in rows}

        existing = (
            await session.execute(
                select(Finding).where(
                    Finding.rule_id == RULE_ID,
                    Finding.claim_group_id == grp.id,
                    Finding.status == "open",
                )
            )
        ).scalar_one_or_none()

        if len(distinct_values) > 1:
            await _open_or_update_finding(
                session,
                group=grp,
                rows=rows,
                distinct_values=distinct_values,
                existing=existing,
            )
            opened += 0 if existing else 1
        else:
            in_sync += 1
            if existing:
                existing.status = "closed"
                existing.closed_at = datetime.now(UTC)
                existing.updated_at = datetime.now(UTC)
                closed += 1

    await session.commit()
    return {
        "groups_evaluated": len(groups),
        "in_sync": in_sync,
        "open_findings_changed": opened,
        "closed": closed,
    }


async def _open_or_update_finding(
    session: AsyncSession,
    *,
    group: ClaimGroup,
    rows: list[tuple[Claim, Artifact]],
    distinct_values: set[str],
    existing: Finding | None,
) -> None:
    project_label = await _project_label(session, group.project_id)
    sources = sorted({a.source for _, a in rows})
    value_list = sorted(distinct_values)
    summary = (
        f"{group.key.capitalize()} date drift in {project_label}: "
        f"{', '.join(value_list)} (across {', '.join(sources)})"
    )

    # Per-source set of values, useful in the UI ("Jira says X; Slack says Y").
    per_source: dict[str, list[dict[str, Any]]] = {}
    for claim, artifact in rows:
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

    if existing is None:
        finding = Finding(
            rule_id=RULE_ID,
            claim_group_id=group.id,
            project_id=group.project_id,
            status="open",
            severity="high",
            summary=summary,
            details=details,
        )
        session.add(finding)
        await session.flush()
    else:
        existing.summary = summary
        existing.details = details
        existing.updated_at = datetime.now(UTC)
        finding = existing

    # Rebuild evidence — easier than diffing claim sets
    for claim, _ in rows:
        await session.execute(
            pg_insert(FindingEvidence)
            .values(finding_id=finding.id, claim_id=claim.id, role="primary")
            .on_conflict_do_nothing(index_elements=[FindingEvidence.finding_id, FindingEvidence.claim_id])
        )


async def _project_label(session: AsyncSession, project_id: int | None) -> str:
    if project_id is None:
        return "(unassigned)"
    p = await session.get(Project, project_id)
    return p.name if p else f"project #{project_id}"
