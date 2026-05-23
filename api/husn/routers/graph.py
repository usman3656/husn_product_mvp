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
