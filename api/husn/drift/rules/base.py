"""DriftRule protocol — table-driven rule shape.

Each concrete rule (R-DATE-1, R-OWNER-1, R-STATUS-1, ...) implements this
interface so the evaluator can iterate `ALL_RULES` without hard-coding
rule ids. Detection is pure: it inspects the claims of a single group
and returns a (drift?, primary-evidence-claims) tuple. The evaluator owns
all DB writes (finding upsert, evidence rebuild, auto-close).

Severity / summary text live with the rule so adding a rule is local to
one file plus a one-line registration in `__init__.py`.
"""

from typing import Any, Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Claim, ClaimGroup


@runtime_checkable
class DriftRule(Protocol):
    """One drift rule. Pure detection — the evaluator handles persistence."""

    rule_id: str
    applies_to_kind: str  # ClaimGroup.kind this rule scans ("date","owner","status")
    severity: str  # "high" | "medium" | "low"
    # Informational; concrete rules build the final summary in build_summary
    # so they can use lookups (project name, source labels) the template alone
    # can't express. Placeholders documented: {kind} {key} {values} {sources}.
    summary_template: str

    def detects(self, group_claims: list[Claim]) -> tuple[bool, list[Claim]]:
        """Return (is_drift, primary_evidence_claims).

        primary_evidence_claims is the subset of `group_claims` that should
        be cited as `role='primary'` on the Finding. Empty list when no drift.
        """
        ...

    async def build_summary(
        self,
        session: AsyncSession,
        *,
        group: ClaimGroup,
        primary_claims: list[Claim],
    ) -> tuple[str, dict[str, Any]]:
        """Return (summary_text, details_json) for the Finding.

        Called only when `detects` reports drift. Rules may join Artifact /
        Project here for human-readable labels.
        """
        ...
