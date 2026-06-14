"""Build a structured dossier for the agent to reason over.

A dossier is a token-bounded snapshot of one project at a moment in time:
  * project info
  * claim groups (with all member claims, value_norm, confidence, source anchor)
  * recent artifacts in time order (titles + bodies, truncated)
  * persons & identities (only those involved in the artifacts/claims)
  * current open findings

Every claim and artifact has a stable id that the agent's output JSON cites
back. Post-LLM we walk the agent's `claim_ids[]` arrays and reject any id
not present in the dossier — that's the anti-hallucination guard.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import (
    Artifact,
    ArtifactMention,
    Claim,
    ClaimGroup,
    ClaimGroupMember,
    Finding,
    Person,
    PersonIdentity,
    Project,
    ProjectSource,
)

MAX_ARTIFACTS_PER_SOURCE = 8
MAX_CLAIMS = 60
MAX_BODY_CHARS = 280  # tight cap; keeps dossier ~3-4K tokens to stay under Groq free-tier 6K TPM


async def build_dossier(session: AsyncSession, *, project_id: int) -> dict[str, Any]:
    project = await session.get(Project, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")

    # Project scopes
    scopes = (
        await session.execute(
            select(ProjectSource).where(ProjectSource.project_id == project_id)
        )
    ).scalars().all()

    # Recent artifacts, capped per source, ordered by occurred_at
    artifacts_rows: list[Artifact] = []
    for source in ("jira", "slack", "google", "granola"):
        rows = (
            await session.execute(
                select(Artifact)
                .where(Artifact.project_id == project_id, Artifact.source == source)
                .order_by(desc(Artifact.occurred_at), desc(Artifact.id))
                .limit(MAX_ARTIFACTS_PER_SOURCE)
            )
        ).scalars().all()
        artifacts_rows.extend(rows)

    artifact_ids = [a.id for a in artifacts_rows]

    # Claims attached to those artifacts (highest-confidence first)
    claims_rows: list[Claim] = []
    if artifact_ids:
        claims_rows = list(
            (
                await session.execute(
                    select(Claim)
                    .where(Claim.source_artifact_id.in_(artifact_ids))
                    .order_by(desc(Claim.confidence), desc(Claim.extracted_at))
                    .limit(MAX_CLAIMS)
                )
            )
            .scalars()
            .all()
        )

    # Claim groups for those claims (so the agent sees which claims are "about
    # the same fact")
    member_rows: list[ClaimGroupMember] = []
    group_ids: set[int] = set()
    if claims_rows:
        member_rows = list(
            (
                await session.execute(
                    select(ClaimGroupMember).where(
                        ClaimGroupMember.claim_id.in_([c.id for c in claims_rows])
                    )
                )
            )
            .scalars()
            .all()
        )
        group_ids = {m.claim_group_id for m in member_rows}

    groups_rows: list[ClaimGroup] = []
    if group_ids:
        groups_rows = list(
            (
                await session.execute(
                    select(ClaimGroup).where(ClaimGroup.id.in_(group_ids))
                )
            )
            .scalars()
            .all()
        )

    claim_to_group: dict[int, int] = {m.claim_id: m.claim_group_id for m in member_rows}

    # Persons involved (authors + mentions)
    person_ids: set[int] = set()
    for a in artifacts_rows:
        if a.author_person_id:
            person_ids.add(a.author_person_id)
    if artifact_ids:
        mention_rows = (
            await session.execute(
                select(ArtifactMention.person_id).where(
                    ArtifactMention.artifact_id.in_(artifact_ids)
                )
            )
        ).all()
        for (pid,) in mention_rows:
            person_ids.add(pid)

    persons_rows: list[Person] = []
    identities_rows: list[PersonIdentity] = []
    if person_ids:
        persons_rows = list(
            (await session.execute(select(Person).where(Person.id.in_(person_ids))))
            .scalars()
            .all()
        )
        identities_rows = list(
            (
                await session.execute(
                    select(PersonIdentity).where(PersonIdentity.person_id.in_(person_ids))
                )
            )
            .scalars()
            .all()
        )
    identities_by_person: dict[int, list[PersonIdentity]] = {}
    for i in identities_rows:
        identities_by_person.setdefault(i.person_id, []).append(i)

    # Open findings on this project
    findings_rows = list(
        (
            await session.execute(
                select(Finding)
                .where(Finding.project_id == project_id, Finding.status == "open")
                .order_by(desc(Finding.opened_at))
            )
        )
        .scalars()
        .all()
    )

    # ---- Serialize ----
    def trunc(s: str | None) -> str | None:
        if s is None:
            return None
        s = s.strip()
        if len(s) > MAX_BODY_CHARS:
            return s[:MAX_BODY_CHARS] + "…"
        return s

    return {
        "project": {
            "id": project.id,
            "slug": project.slug,
            "name": project.name,
            "scopes": [
                {"source": s.source, "kind": s.scope_kind, "id": s.scope_id}
                for s in scopes
            ],
        },
        "persons": [
            {
                "id": p.id,
                "name": p.primary_name,
                "email": p.primary_email,
                "identities": [
                    {"source": i.source, "user_id": i.source_user_id, "name": i.display_name}
                    for i in identities_by_person.get(p.id, [])
                ],
            }
            for p in persons_rows
        ],
        "artifacts": [
            {
                "id": a.id,
                "source": a.source,
                "kind": a.kind,
                "title": a.title,
                "body": trunc(a.body),
                "occurred_at": a.occurred_at.isoformat() if a.occurred_at else None,
                "author_person_id": a.author_person_id,
                "url": a.url,
                "status": a.status,
            }
            for a in artifacts_rows
        ],
        "claim_groups": [
            {"id": g.id, "kind": g.kind, "key": g.key}
            for g in groups_rows
        ],
        "claims": [
            {
                "id": c.id,
                "artifact_id": c.source_artifact_id,
                "claim_group_id": claim_to_group.get(c.id),
                "kind": c.kind,
                "key": c.key,
                "value_norm": c.value_norm,
                "value": c.value,
                "confidence": c.confidence,
                "extractor": c.extractor_id,
                "source_anchor": c.source_anchor,
            }
            for c in claims_rows
        ],
        "open_findings": [
            {
                "id": f.id,
                "rule_id": f.rule_id,
                "summary": f.summary,
                "severity": f.severity,
                "opened_at": f.opened_at.isoformat(),
            }
            for f in findings_rows
        ],
    }


def valid_claim_ids(dossier: dict[str, Any]) -> set[int]:
    return {c["id"] for c in dossier.get("claims", [])}


def valid_artifact_ids(dossier: dict[str, Any]) -> set[int]:
    return {a["id"] for a in dossier.get("artifacts", [])}
