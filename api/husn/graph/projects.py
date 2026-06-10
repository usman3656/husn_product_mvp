"""Default project + auto-scope rule for MVP.

Step 2 doesn't ship a project-management UI. We auto-create a project named
'All work' on first run and attach every Slack channel + Jira project we see
as scopes, so newly-ingested artifacts have somewhere to land.

Tenancy (TENANCY.md C3): the default project is PER-TENANT. During the
AUTH_REQUIRED=0 bridge tenant_id is None and behavior is identical to
pre-tenancy (one global 'All work'). After the C4 cutover each company gets
its own default project the first time its data is normalized, and scopes
attach within that tenant only.

A real customer setup will later let the user split this into per-program
projects (e.g. 'Project Atlas') and re-assign scopes; that UI is out of scope
for Step 2.
"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Project, ProjectSource, RawArtifact
from husn.graph.tenancy_context import current_tenant_id

DEFAULT_PROJECT_SLUG = "all-work"
DEFAULT_PROJECT_NAME = "All work"


async def get_or_create_default_project(
    session: AsyncSession, tenant_id: int | None = None
) -> Project:
    q = select(Project).where(Project.slug == DEFAULT_PROJECT_SLUG)
    if tenant_id is not None:
        q = q.where(Project.tenant_id == tenant_id)
    result = await session.execute(q)
    project = result.scalar_one_or_none()
    if project:
        return project
    # NOTE: projects.slug is globally unique until migration 0010 re-keys it
    # to (tenant_id, slug). During the bridge only one 'all-work' exists, so
    # this insert cannot collide; after 0010 each tenant gets its own.
    project = Project(tenant_id=tenant_id, slug=DEFAULT_PROJECT_SLUG, name=DEFAULT_PROJECT_NAME)
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


async def auto_scope_from_raw_artifacts(
    session: AsyncSession, project_id: int, tenant_id: int | None = None
) -> int:
    """Sweep raw_artifacts and attach any channel/project we haven't scoped yet.

    Tenant-scoped: only this tenant's raw rows feed this tenant's project
    scopes (no filter during the bridge).
    """
    added = 0

    # Slack channels
    ch_q = select(RawArtifact).where(RawArtifact.source == "slack", RawArtifact.kind == "channel")
    if tenant_id is not None:
        ch_q = ch_q.where(RawArtifact.tenant_id == tenant_id)
    chs = await session.execute(ch_q)
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
    prj_q = select(RawArtifact).where(RawArtifact.source == "jira", RawArtifact.kind == "project")
    if tenant_id is not None:
        prj_q = prj_q.where(RawArtifact.tenant_id == tenant_id)
    prjs = await session.execute(prj_q)
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
    """Given a (source, scope_kind, scope_id), return the project_id it maps to.

    Tenant-scoped via the normalize ContextVar: two tenants can both attach
    the same Slack channel id (post-0010 the unique constraint is per-project)
    — each must resolve to THEIR project. Returns the first match in bridge
    mode for backwards compatibility.
    """
    if not scope_id:
        return None
    tenant_id = current_tenant_id.get()
    q = select(ProjectSource.project_id).where(
        ProjectSource.source == source,
        ProjectSource.scope_kind == scope_kind,
        ProjectSource.scope_id == scope_id,
    )
    if tenant_id is not None:
        q = q.join(Project, Project.id == ProjectSource.project_id).where(
            Project.tenant_id == tenant_id
        )
    result = await session.execute(q.limit(1))
    return result.scalar_one_or_none()
