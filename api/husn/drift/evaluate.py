"""Drift evaluation cron entrypoint.

Sequence each tick:
  1. Assign any unassigned claims to claim_groups.
  2. Run each active rule's evaluator.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from husn.core.logging import log
from husn.drift.grouping import assign_unassigned_claims
from husn.drift.rules import r_date_1


async def evaluate_drift(session: AsyncSession) -> dict[str, dict | int]:
    grouping = await assign_unassigned_claims(session)
    r_date_1_summary = await r_date_1.evaluate(session)
    result = {"grouping": grouping, "r_date_1": r_date_1_summary}
    if grouping["considered"] or r_date_1_summary["open_findings_changed"] or r_date_1_summary["closed"]:
        log.info("husn.drift.evaluate", **{"grouping": grouping, "r_date_1": r_date_1_summary})
    return result
