"""Brief skeleton builder for Step 5/6 v2 agent.

Pure deterministic function over the structured store. The LLM never reaches
into claims/findings directly; it only sees this skeleton and renders prose
that cites the included claim_ids. No retrieval at render time. No
re-extraction. The grouper + drift rules have already done their work upstream
when this runs.

Shape of the skeleton:
    {
      "viewer_id":   "...",     # who the brief is for (hard scope param)
      "persona":     "qa_lead",
      "project_id":  1,
      "as_of":       "2026-06-05T14:00:00Z",
      "facts":       [Fact, ...],
      "conflicts":   [Conflict, ...],
      "changes_since_last_brief": [Change, ...],
      "blockers_for_persona":     [Blocker, ...],
      "expected_loops_missed":    [Miss, ...],
    }

Stage 1 scope (this file): facts + conflicts + blockers. changes and
expected_loops_missed are emitted as empty lists so the schema is stable; they
fill in when topic-segment diffing + the absence detector land in Stage 2.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Iterable

from sqlalchemy import desc, select
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


# ---------- Skeleton record types ----------


@dataclass
class FactCandidate:
    """One source-claim's contribution to a fact or conflict candidate."""

    claim_id: int
    artifact_id: int
    source: str
    value: str | None
    value_norm: str | None
    confidence: float
    source_anchor: dict[str, Any]


@dataclass
class Fact:
    """A claim_group with a single dominant value. No drift here."""

    claim_group_id: int
    kind: str
    key: str
    value: str | None
    value_norm: str | None
    source_claim_ids: list[int]
    sources: list[FactCandidate]


@dataclass
class ConflictCandidate:
    """One side of a multi-valued conflict (grouped by value_norm)."""

    value: str | None
    value_norm: str | None
    source_claim_ids: list[int]
    sources: list[FactCandidate]


@dataclass
class Conflict:
    """A finding rendered as a side-by-side comparison. The renderer must NOT
    pick a winner; it must render every candidate equally.
    """

    finding_id: int
    rule_id: str
    severity: str
    claim_group_id: int
    kind: str
    key: str
    summary: str
    candidates: list[ConflictCandidate]


@dataclass
class Blocker:
    """An open high-severity finding the persona ought to be told about."""

    finding_id: int
    rule_id: str
    summary: str
    severity: str
    opened_at: str


@dataclass
class Skeleton:
    viewer_id: str | None
    persona: str
    project_id: int
    project_name: str
    as_of: str
    facts: list[Fact] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)
    changes_since_last_brief: list[dict] = field(default_factory=list)
    blockers_for_persona: list[Blocker] = field(default_factory=list)
    expected_loops_missed: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def claim_id_set(self) -> set[int]:
        """Every claim_id reachable from this skeleton. The NLI verifier and
        the renderer-output citation validator use this as the universe of
        allowed citations.
        """
        ids: set[int] = set()
        for f in self.facts:
            ids.update(f.source_claim_ids)
        for c in self.conflicts:
            for cand in c.candidates:
                ids.update(cand.source_claim_ids)
        return ids


# ---------- Builder ----------


async def build_skeleton(
    session: AsyncSession,
    *,
    project_id: int,
    persona: str = "default",
    viewer_id: str | None = None,
    as_of: datetime | None = None,
) -> Skeleton:
    """Build the typed skeleton for one (project, persona, viewer) tuple.

    Pure: no LLM, no caching, no side-effects. Calling it twice with the same
    inputs and the same DB state returns identical output.

    `persona` is currently informational only — Stage 1 ships the same fact
    set to every persona. Persona-specific filtering / blockers come next.
    """
    project = await session.get(Project, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")

    as_of = as_of or datetime.now(UTC)

    # --------- Pull everything we need in one pass per table ---------
    claim_groups: list[ClaimGroup] = list(
        (
            await session.execute(
                select(ClaimGroup).where(ClaimGroup.project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    group_ids = [g.id for g in claim_groups]
    group_by_id: dict[int, ClaimGroup] = {g.id: g for g in claim_groups}

    members: list[ClaimGroupMember] = []
    if group_ids:
        members = list(
            (
                await session.execute(
                    select(ClaimGroupMember).where(
                        ClaimGroupMember.claim_group_id.in_(group_ids)
                    )
                )
            )
            .scalars()
            .all()
        )

    claim_ids_in_groups = [m.claim_id for m in members]
    claims: list[Claim] = []
    if claim_ids_in_groups:
        claims = list(
            (
                await session.execute(
                    select(Claim).where(Claim.id.in_(claim_ids_in_groups))
                )
            )
            .scalars()
            .all()
        )
    claim_by_id: dict[int, Claim] = {c.id: c for c in claims}

    # source for each claim's artifact
    art_ids = {c.source_artifact_id for c in claims}
    arts: list[Artifact] = []
    if art_ids:
        arts = list(
            (await session.execute(select(Artifact).where(Artifact.id.in_(art_ids))))
            .scalars()
            .all()
        )
    art_source_by_id: dict[int, str] = {a.id: a.source for a in arts}

    findings: list[Finding] = list(
        (
            await session.execute(
                select(Finding)
                .where(
                    Finding.project_id == project_id,
                    Finding.status == "open",
                )
                .order_by(desc(Finding.opened_at))
            )
        )
        .scalars()
        .all()
    )
    findings_by_group: dict[int, Finding] = {f.claim_group_id: f for f in findings}

    finding_ids = [f.id for f in findings]
    evidence: list[FindingEvidence] = []
    if finding_ids:
        evidence = list(
            (
                await session.execute(
                    select(FindingEvidence).where(
                        FindingEvidence.finding_id.in_(finding_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
    evidence_by_finding: dict[int, list[FindingEvidence]] = defaultdict(list)
    for e in evidence:
        evidence_by_finding[e.finding_id].append(e)

    # --------- Index claims by their group ---------
    group_to_active_claims: dict[int, list[Claim]] = defaultdict(list)
    for m in members:
        c = claim_by_id.get(m.claim_id)
        if c is None:
            continue
        # `status` may be NULL on existing rows; treat NULL as active.
        if (c.status or "active") != "active":
            continue
        group_to_active_claims[m.claim_group_id].append(c)

    facts: list[Fact] = []
    conflicts: list[Conflict] = []

    for group_id, group in group_by_id.items():
        cs = group_to_active_claims.get(group_id, [])
        if not cs:
            continue
        finding = findings_by_group.get(group_id)
        if finding is not None:
            conflicts.append(
                _build_conflict(
                    finding=finding,
                    group=group,
                    evidence=evidence_by_finding.get(finding.id, []),
                    claim_by_id=claim_by_id,
                    art_source_by_id=art_source_by_id,
                )
            )
        else:
            facts.append(
                _build_fact(group=group, claims=cs, art_source_by_id=art_source_by_id)
            )

    # --------- Blockers (Stage 1: every high-severity open finding) ---------
    blockers = [
        Blocker(
            finding_id=f.id,
            rule_id=f.rule_id,
            summary=f.summary,
            severity=f.severity,
            opened_at=f.opened_at.astimezone(UTC).isoformat(),
        )
        for f in findings
        if f.severity == "high"
    ]

    return Skeleton(
        viewer_id=viewer_id,
        persona=persona,
        project_id=project_id,
        project_name=project.name,
        as_of=as_of.astimezone(UTC).isoformat(),
        facts=facts,
        conflicts=conflicts,
        changes_since_last_brief=[],  # Stage 2
        blockers_for_persona=blockers,
        expected_loops_missed=[],  # Stage 2 (absence detector)
    )


# ---------- Internal helpers ----------


def _candidate(claim: Claim, art_source_by_id: dict[int, str]) -> FactCandidate:
    return FactCandidate(
        claim_id=claim.id,
        artifact_id=claim.source_artifact_id,
        source=art_source_by_id.get(claim.source_artifact_id, "unknown"),
        value=claim.value,
        value_norm=claim.value_norm,
        confidence=float(claim.confidence or 0.0),
        source_anchor=claim.source_anchor or {},
    )


def _build_fact(
    *,
    group: ClaimGroup,
    claims: list[Claim],
    art_source_by_id: dict[int, str],
) -> Fact:
    # Dominant value: highest sum-of-confidence per value_norm.
    by_norm: dict[str | None, list[Claim]] = defaultdict(list)
    for c in claims:
        by_norm[c.value_norm].append(c)
    dominant_norm = max(
        by_norm,
        key=lambda n: sum(float(c.confidence or 0.0) for c in by_norm[n]),
    )
    dominant_claims = by_norm[dominant_norm]
    # Pretty-printed value: pick the highest-confidence claim's raw value.
    rep = max(dominant_claims, key=lambda c: float(c.confidence or 0.0))
    return Fact(
        claim_group_id=group.id,
        kind=group.kind,
        key=group.key,
        value=rep.value,
        value_norm=rep.value_norm,
        source_claim_ids=[c.id for c in dominant_claims],
        sources=[_candidate(c, art_source_by_id) for c in dominant_claims],
    )


def _build_conflict(
    *,
    finding: Finding,
    group: ClaimGroup,
    evidence: list[FindingEvidence],
    claim_by_id: dict[int, Claim],
    art_source_by_id: dict[int, str],
) -> Conflict:
    # Bucket evidence claims by value_norm so the renderer sees one block per
    # distinct candidate.
    by_norm: dict[str | None, list[Claim]] = defaultdict(list)
    for e in evidence:
        c = claim_by_id.get(e.claim_id)
        if c is None:
            continue
        by_norm[c.value_norm].append(c)

    candidates: list[ConflictCandidate] = []
    for norm, cs in by_norm.items():
        rep = max(cs, key=lambda c: float(c.confidence or 0.0))
        candidates.append(
            ConflictCandidate(
                value=rep.value,
                value_norm=norm,
                source_claim_ids=[c.id for c in cs],
                sources=[_candidate(c, art_source_by_id) for c in cs],
            )
        )

    return Conflict(
        finding_id=finding.id,
        rule_id=finding.rule_id,
        severity=finding.severity,
        claim_group_id=finding.claim_group_id,
        kind=group.kind,
        key=group.key,
        summary=finding.summary,
        candidates=candidates,
    )


# ---------- Convenience for tests / one-off scripts ----------


def claim_ids_in(skel: Skeleton | dict[str, Any]) -> set[int]:
    """Stand-alone version of Skeleton.claim_id_set so the validator can also
    consume the dict form (after a JSON round-trip).
    """
    if isinstance(skel, Skeleton):
        return skel.claim_id_set()
    ids: set[int] = set()
    for f in skel.get("facts", []):
        ids.update(f.get("source_claim_ids", []))
    for c in skel.get("conflicts", []):
        for cand in c.get("candidates", []):
            ids.update(cand.get("source_claim_ids", []))
    return ids


def _values_iter(skel: Skeleton) -> Iterable[str]:
    """Just the rendered string values, for log/debug output."""
    for f in skel.facts:
        yield f"fact[{f.kind}:{f.key}] = {f.value!r}"
    for c in skel.conflicts:
        cs = ", ".join(repr(cand.value) for cand in c.candidates)
        yield f"conflict[{c.kind}:{c.key}] = {{{cs}}}"
