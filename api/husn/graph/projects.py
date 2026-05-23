"""Default project + auto-scope rule for MVP.

Step 2 doesn't ship a project-management UI. We auto-create a project named
'All work' on first run and attach every Slack channel + Jira project we see
as scopes, so newly-ingested artifacts have somewhere to land.

A real customer setup will later let the user split this into per-program
projects (e.g. 'Project Atlas') and re-assign scopes; that UI is out of scope
for Step 2.
"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Project, ProjectSource, RawArtifact

DEFAULT_PROJECT_SLUG = "all-work"
DEFAULT_PROJECT_NAME = "All work"


async def get_or_create_default_project(session: AsyncSession) -> Project:
    result = await session.execute(select(Project).where(Project.slug == DEFAULT_PROJECT_SLUG))
    project = result.scalar_one_or_none()
    if project:
        return project
    project = Project(slug=DEFAULT_PROJECT_SLUG, name=DEFAULT_PROJECT_NAME)
    session.add(project)
    await session.flush()
    return project


async def ensure_scope(
    session: AsyncSession,
    *,
    project_id: int,
    source: str,
    scope_kind: str,
    scope_id: str,
) -> None:
    """Idempotent upsert of a ProjectSource attachment."""
    stmt = (
        pg_insert(ProjectSource)
        .values(
            project_id=project_id,
            source=source,
            scope_kind=scope_kind,
            scope_id=scope_id,
        )
        .on_conflict_do_nothing(constraint="uq_project_source_scope")
    )
    await session.execute(stmt)


async def auto_scope_from_raw_artifacts(session: AsyncSession, project_id: int) -> int:
    """Sweep raw_artifacts and attach any channel/project we haven't scoped yet."""
    added = 0

    # Slack channels
    chs = await session.execute(
        select(RawArtifact).where(RawArtifact.source == "slack", RawArtifact.kind == "channel")
    )
    for r in chs.scalars():
        ch_id = (r.payload or {}).get("id")
        if not ch_id:
            continue
        await ensure_scope(
            session,
            project_id=project_id,
            source="slack",
            scope_kind="channel",
            scope_id=ch_id,
        )
        added += 1

    # Jira projects
    prjs = await session.execute(
        select(RawArtifact).where(RawArtifact.source == "jira", RawArtifact.kind == "project")
    )
    for r in prjs.scalars():
        key = (r.payload or {}).get("key")
        if not key:
            continue
        await ensure_scope(
            session,
            project_id=project_id,
            source="jira",
            scope_kind="project",
            scope_id=key,
        )
        added += 1

    return added


async def resolve_project_for(
    session: AsyncSession, *, source: str, scope_kind: str, scope_id: str
) -> int | None:
    """Given a (source, scope_kind, scope_id), return the project_id it maps to."""
    if not scope_id:
        return None
    result = await session.execute(
        select(ProjectSource.project_id).where(
            ProjectSource.source == source,
            ProjectSource.scope_kind == scope_kind,
            ProjectSource.scope_id == scope_id,
        )
    )
    return result.scalar_one_or_none()
