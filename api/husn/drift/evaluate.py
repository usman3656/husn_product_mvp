"""Drift evaluation cron entrypoint.

Sequence each tick:
  1. Assign any unassigned claims to claim_groups.
  2. For every rule in ALL_RULES, walk the matching claim_groups and
     open / update / auto-close findings.

The evaluator is table-driven over `ALL_RULES`; it knows nothing about
specific rule ids. Adding R-DECISION-1 etc. requires only a new module
under husn/drift/rules and a single entry in rules/__init__.py.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.core.logging import log
from husn.db.models import Claim, ClaimGroup, ClaimGroupMember, Finding, FindingEvidence
from husn.drift.grouping import assign_unassigned_claims
from husn.drift.rules import ALL_RULES, DriftRule


async def evaluate_drift(session: AsyncSession) -> dict[str, dict | int]:
    grouping = await assign_unassigned_claims(session)

    per_rule: dict[str, dict[str, int]] = {}
    for rule in ALL_RULES:
        per_rule[rule.rule_id] = await _evaluate_rule(session, rule)

    await session.commit()

    result: dict[str, dict | int] = {"grouping": grouping, **per_rule}
    any_change = grouping["considered"] or any(
        s["open_findings_changed"] or s["closed"] for s in per_rule.values()
    )
    if any_change:
        log.info("husn.drift.evaluate", **result)
    return result


async def _evaluate_rule(session: AsyncSession, rule: DriftRule) -> dict[str, int]:
    """Run one rule across every claim_group of its applies_to_kind."""
    groups = (
        await session.execute(
            select(ClaimGroup).where(ClaimGroup.kind == rule.applies_to_kind)
        )
    ).scalars().all()

    opened = 0
    closed = 0
    in_sync = 0

    for grp in groups:
        claims = (
            await session.execute(
                select(Claim)
                .join(ClaimGroupMember, ClaimGroupMember.claim_id == Claim.id)
                .where(ClaimGroupMember.claim_group_id == grp.id)
            )
        ).scalars().all()
        if not claims:
            continue

        is_drift, primary_claims = rule.detects(list(claims))

        existing = (
            await session.execute(
                select(Finding).where(
                    Finding.rule_id == rule.rule_id,
                    Finding.claim_group_id == grp.id,
                    Finding.status == "open",
                )
            )
        ).scalar_one_or_none()

        if is_drift:
            summary, details = await rule.build_summary(
                session, group=grp, primary_claims=primary_claims
            )
            await _upsert_finding(
                session,
                rule=rule,
                group=grp,
                primary_claims=primary_claims,
                summary=summary,
                details=details,
                existing=existing,
            )
            if existing is None:
                opened += 1
        else:
            in_sync += 1
            if existing:
                existing.status = "closed"
                existing.closed_at = datetime.now(UTC)
                existing.updated_at = datetime.now(UTC)
                closed += 1

    return {
        "groups_evaluated": len(groups),
        "in_sync": in_sync,
        "open_findings_changed": opened,
        "closed": closed,
    }


async def _upsert_finding(
    session: AsyncSession,
    *,
    rule: DriftRule,
    group: ClaimGroup,
    primary_claims: list[Claim],
    summary: str,
    details: dict,
    existing: Finding | None,
) -> None:
    """Insert a new Finding or update the existing open one, then (re)write
    primary evidence rows. The partial unique index on findings ensures at
    most one OPEN row per (rule_id, claim_group_id).
    """
    if existing is None:
        finding = Finding(
            tenant_id=group.tenant_id,
            rule_id=rule.rule_id,
            claim_group_id=group.id,
            project_id=group.project_id,
            status="open",
            severity=rule.severity,
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

    # Rebuild evidence — easier than diffing claim sets.
    for claim in primary_claims:
        await session.execute(
            pg_insert(FindingEvidence)
            .values(finding_id=finding.id, claim_id=claim.id, role="primary")
            .on_conflict_do_nothing(
                index_elements=[FindingEvidence.finding_id, FindingEvidence.claim_id]
            )
        )
