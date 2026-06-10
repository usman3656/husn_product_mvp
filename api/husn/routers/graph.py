"""Operational graph endpoints — what Step 2 produces, in JSON."""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_member
from husn.auth.scope import tenant_where
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
async def summary(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Counts + most-recent timestamps. Cheap; safe to poll from the dashboard."""

    async def scalar(q):
        return (await session.execute(q)).scalar_one()

    persons = await scalar(tenant_where(select(func.count(Person.id)), Person, ctx))
    identities = await scalar(
        tenant_where(select(func.count(PersonIdentity.id)), PersonIdentity, ctx)
    )
    projects = await scalar(tenant_where(select(func.count(Project.id)), Project, ctx))
    # ProjectSource has no tenant_id — derive via the owning Project.
    scopes_q = select(func.count(ProjectSource.id))
    if ctx.tenant_id is not None:
        scopes_q = scopes_q.join(Project, Project.id == ProjectSource.project_id).where(
            Project.tenant_id == ctx.tenant_id
        )
    scopes = await scalar(scopes_q)
    artifacts = await scalar(tenant_where(select(func.count(Artifact.id)), Artifact, ctx))
    # ArtifactMention has no tenant_id — derive via the joined Artifact.
    mentions_q = select(func.count()).select_from(ArtifactMention)
    if ctx.tenant_id is not None:
        mentions_q = mentions_q.join(
            Artifact, Artifact.id == ArtifactMention.artifact_id
        ).where(Artifact.tenant_id == ctx.tenant_id)
    mentions = await scalar(mentions_q)
    raw_pending = await scalar(
        tenant_where(
            select(func.count(RawArtifact.id))
            .outerjoin(Artifact, Artifact.raw_artifact_id == RawArtifact.id)
            .where(Artifact.id.is_(None)),
            RawArtifact,
            ctx,
        )
    )
    last_raw = (
        await session.execute(
            tenant_where(select(func.max(RawArtifact.fetched_at)), RawArtifact, ctx)
        )
    ).scalar()
    last_normalized = (
        await session.execute(
            tenant_where(select(func.max(Artifact.normalized_at)), Artifact, ctx)
        )
    ).scalar()

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
async def list_projects(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    proj_rows = (
        await session.execute(tenant_where(select(Project).order_by(Project.id), Project, ctx))
    ).scalars().all()

    out = []
    for p in proj_rows:
        scopes = (
            await session.execute(
                select(ProjectSource).where(ProjectSource.project_id == p.id)
            )
        ).scalars().all()
        artifact_count = (
            await session.execute(
                tenant_where(
                    select(func.count(Artifact.id)).where(Artifact.project_id == p.id),
                    Artifact,
                    ctx,
                )
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
    ctx: AuthContext = Depends(require_member),
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
    # ArtifactMention has no tenant_id — filter via the joined Artifact.
    stmt = tenant_where(stmt, Artifact, ctx)
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
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    persons = (
        await session.execute(
            tenant_where(select(Person).order_by(Person.id.desc()).limit(limit), Person, ctx)
        )
    ).scalars().all()

    out = []
    for p in persons:
        ids = (
            await session.execute(
                tenant_where(
                    select(PersonIdentity).where(PersonIdentity.person_id == p.id),
                    PersonIdentity,
                    ctx,
                )
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
