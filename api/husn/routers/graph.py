"""Operational graph endpoints — what Step 2 produces, in JSON."""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import (
    Artifact,
    ArtifactMention,
    Person,
    PersonIdentity,
    Project,
    ProjectSource,
    RawArtifact,
)
from husn.db.session import get_session

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("/summary")
async def summary(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Counts + most-recent timestamps. Cheap; safe to poll from the dashboard."""

    async def scalar(q):
        return (await session.execute(q)).scalar_one()

    persons = await scalar(select(func.count(Person.id)))
    identities = await scalar(select(func.count(PersonIdentity.id)))
    projects = await scalar(select(func.count(Project.id)))
    scopes = await scalar(select(func.count(ProjectSource.id)))
    artifacts = await scalar(select(func.count(Artifact.id)))
    mentions = await scalar(select(func.count()).select_from(ArtifactMention))
    raw_pending = await scalar(
        select(func.count(RawArtifact.id))
        .outerjoin(Artifact, Artifact.raw_artifact_id == RawArtifact.id)
        .where(Artifact.id.is_(None))
    )
    last_raw = (await session.execute(select(func.max(RawArtifact.fetched_at)))).scalar()
    last_normalized = (await session.execute(select(func.max(Artifact.normalized_at)))).scalar()

    return {
        "counts": {
            "persons": persons,
            "person_identities": identities,
            "projects": projects,
            "project_sources": scopes,
            "artifacts": artifacts,
            "artifact_mentions": mentions,
            "raw_pending_normalization": raw_pending,
        },
        "last_raw_fetched_at": last_raw.isoformat() if last_raw else None,
        "last_normalized_at": last_normalized.isoformat() if last_normalized else None,
    }


@router.get("/projects")
async def list_projects(session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    proj_rows = (await session.execute(select(Project).order_by(Project.id))).scalars().all()

    out = []
    for p in proj_rows:
        scopes = (
            await session.execute(
                select(ProjectSource).where(ProjectSource.project_id == p.id)
            )
        ).scalars().all()
        artifact_count = (
            await session.execute(
                select(func.count(Artifact.id)).where(Artifact.project_id == p.id)
            )
        ).scalar_one()
        out.append(
            {
                "id": p.id,
                "slug": p.slug,
                "name": p.name,
                "artifact_count": artifact_count,
                "scopes": [
                    {"source": s.source, "kind": s.scope_kind, "id": s.scope_id} for s in scopes
                ],
            }
        )
    return {"projects": out}


@router.get("/people-projects")
async def people_projects_matrix(
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Person × Project involvement matrix.

    Joins ArtifactMention → Artifact and counts (person_id, project_id, kind)
    occurrences. Roles are folded into "any" plus the dominant kind (author /
    assignee / mention / watcher) for that pair.

    Used by the Organization page's editorial People × Workstreams matrix
    so we never need to draw a graph.
    """
    stmt = (
        select(
            ArtifactMention.person_id,
            Artifact.project_id,
            ArtifactMention.kind,
            func.count().label("c"),
        )
        .join(Artifact, Artifact.id == ArtifactMention.artifact_id)
        .where(Artifact.project_id.is_not(None))
        .group_by(ArtifactMention.person_id, Artifact.project_id, ArtifactMention.kind)
    )
    rows = (await session.execute(stmt)).all()

    # Roll up per (person, project) into a dominant role + total count.
    bucket: dict[tuple[int, int], dict[str, Any]] = {}
    for r in rows:
        key = (r.person_id, r.project_id)
        b = bucket.setdefault(key, {"person_id": r.person_id, "project_id": r.project_id, "total": 0, "kinds": {}})
        b["total"] += r.c
        b["kinds"][r.kind] = b["kinds"].get(r.kind, 0) + r.c

    items = []
    for entry in bucket.values():
        kinds = entry["kinds"]
        # Dominant role: author > assignee > watcher > mention (preference order
        # so owners surface ahead of casual mentions).
        order = ["author", "assignee", "watcher", "mention"]
        dominant = sorted(kinds.items(), key=lambda kv: (order.index(kv[0]) if kv[0] in order else 99, -kv[1]))[0][0]
        items.append(
            {
                "person_id": entry["person_id"],
                "project_id": entry["project_id"],
                "total": entry["total"],
                "dominant_role": dominant,
            }
        )

    return {"count": len(items), "items": items}


@router.get("/persons")
async def list_persons(
    limit: int = 100, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    persons = (
        await session.execute(select(Person).order_by(Person.id.desc()).limit(limit))
    ).scalars().all()

    out = []
    for p in persons:
        ids = (
            await session.execute(
                select(PersonIdentity).where(PersonIdentity.person_id == p.id)
            )
        ).scalars().all()
        out.append(
            {
                "id": p.id,
                "primary_name": p.primary_name,
                "primary_email": p.primary_email,
                "identities": [
                    {
                        "source": i.source,
                        "source_user_id": i.source_user_id,
                        "display_name": i.display_name,
                        "email": i.email,
                    }
                    for i in ids
                ],
            }
        )
    return {"count": len(out), "persons": out}
