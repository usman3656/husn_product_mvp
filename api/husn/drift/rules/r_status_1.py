"""R-STATUS-1 — status drift across sources within a 7-day window.

Trigger: within the same claim_group (kind='status'), at least one claim
reports a "worst" status (at-risk / blocked / delayed) AND at least one
other claim reports a "best" status (on-track / complete), with both
observed in the last 7 days.

Rationale: stale claims (e.g. a Jira ticket marked "Blocked" three months
ago) shouldn't fire drift against today's "On track" Slack note. The window
keeps the signal current. The 7-day rolling window matches knowledge.md §4
on freshness for delivery-status signals.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Artifact, Claim, ClaimGroup

RULE_ID = "R-STATUS-1"
WINDOW_DAYS = 7

# Normalize both underscore and hyphen forms — Slack extractor emits hyphenated
# tokens; future structured sources may emit underscored.
_WORST = {"at-risk", "at_risk", "blocked", "delayed"}
_BEST = {"on-track", "on_track", "complete", "done"}


def _norm(c: Claim) -> str | None:
    return (c.value_norm or "").lower() or None


class RStatus1:
    rule_id: str = RULE_ID
    applies_to_kind: str = "status"
    severity: str = "high"
    summary_template: str = (
        "Status drift in {kind}/{key}: marked {worst} in {a} but {best} in {b}"
    )

    def detects(self, group_claims: list[Claim]) -> tuple[bool, list[Claim]]:
        cutoff = datetime.now(UTC) - timedelta(days=WINDOW_DAYS)
        recent = [c for c in group_claims if c.extracted_at and c.extracted_at >= cutoff]
        worst = [c for c in recent if _norm(c) in _WORST]
        best = [c for c in recent if _norm(c) in _BEST]
        if worst and best:
            return True, worst + best
        return False, []

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

        worst_claims = [c for c in primary_claims if _norm(c) in _WORST]
        best_claims = [c for c in primary_claims if _norm(c) in _BEST]
        worst = worst_claims[0]
        best = best_claims[0]
        a_source = art_by_id[worst.source_artifact_id].source
        b_source = art_by_id[best.source_artifact_id].source
        summary = (
            f"Status drift in {group.kind}/{group.key}: "
            f"marked {worst.value_norm} in {a_source} but {best.value_norm} in {b_source}."
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
                    "extracted_at": claim.extracted_at.isoformat() if claim.extracted_at else None,
                    "extractor_id": claim.extractor_id,
                    "source_anchor": claim.source_anchor,
                }
            )
        details = {
            "kind": group.kind,
            "key": group.key,
            "window_days": WINDOW_DAYS,
            "worst_status": worst.value_norm,
            "best_status": best.value_norm,
            "per_source": per_source,
        }
        return summary, details


rule = RStatus1()
