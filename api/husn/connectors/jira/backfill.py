"""Jira backfill: list projects, paginate issues, upsert into raw_artifacts."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.jira.client import JiraClient
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.upsert import upsert_raw_artifact


async def backfill_connection(session: AsyncSession, connection: Connection) -> dict[str, int]:
    """Backfill projects + issues for one Atlassian site connection.

    Returns a count summary. Idempotent — re-running yields the same row ids.
    """
    counts = {"projects": 0, "issues": 0}
    async with JiraClient(connection=connection, session=session) as jc:
        projects = await jc.list_projects()
        for p in projects:
            await upsert_raw_artifact(
                session,
                source="jira",
                kind="project",
                external_id=f"{connection.account_id}:project:{p['id']}",
                payload=p,
                tenant_id=connection.tenant_id,
            )
            counts["projects"] += 1

        # Pull issues for each project. JQL is per-project so each project's
        # rate limit / 429 isolation is clean.
        for p in projects:
            project_key = p.get("key")
            if not project_key:
                continue
            await _backfill_issues(jc, session, connection, project_key, counts)
    await session.commit()
    log.info("husn.jira.backfill.done", account_id=connection.account_id, **counts)
    return counts


async def _backfill_issues(
    jc: JiraClient,
    session: AsyncSession,
    connection: Connection,
    project_key: str,
    counts: dict[str, int],
) -> None:
    jql = f"project = {project_key} ORDER BY updated DESC"
    next_token: str | None = None
    while True:
        page = await jc.search_issues_page(jql=jql, next_page_token=next_token)
        issues: list[dict[str, Any]] = page.get("issues", []) or []
        for issue in issues:
            await upsert_raw_artifact(
                session,
                source="jira",
                kind="issue",
                external_id=f"{connection.account_id}:issue:{issue['id']}",
                payload=issue,
                tenant_id=connection.tenant_id,
            )
            counts["issues"] += 1
        next_token = page.get("nextPageToken")
        if page.get("isLast", True) or not next_token:
            break


async def get_connections(session: AsyncSession) -> list[Connection]:
    result = await session.execute(select(Connection).where(Connection.source == "jira"))
    return list(result.scalars().all())
