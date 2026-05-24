"""Dispatch raw_artifacts → normalizers, idempotently.

A raw_artifact is "pending" if no `artifacts` row references it. We pick those
up in batches and run the matching normalizer. Re-runnable on schema changes:
  delete from artifacts;  -- forces full re-normalize next pass
"""

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.core.logging import log
from husn.db.models import Artifact, Connection, RawArtifact
from husn.graph.normalizers.google import (
    normalize_google_doc,
    normalize_google_drive_file,
    normalize_google_drive_folder,
    normalize_google_email,
    normalize_google_sheet,
)
from husn.graph.normalizers.microsoft import (
    normalize_ms_drive_file,
    normalize_ms_drive_folder,
    normalize_ms_email,
    normalize_ms_office_doc,
    normalize_ms_office_sheet,
    normalize_ms_office_slides,
)
from husn.graph.normalizers.jira import normalize_jira_issue, normalize_jira_project
from husn.graph.normalizers.slack import (
    normalize_slack_channel,
    normalize_slack_message,
    normalize_slack_user,
)
from husn.graph.projects import (
    auto_scope_from_raw_artifacts,
    get_or_create_default_project,
)

# (source, kind) -> normalizer
_DISPATCH: dict[tuple[str, str], Callable[..., Awaitable[Any]]] = {
    ("jira", "issue"): normalize_jira_issue,
    ("jira", "project"): normalize_jira_project,
    ("slack", "message"): normalize_slack_message,
    ("slack", "channel"): normalize_slack_channel,
    ("slack", "user"): normalize_slack_user,
    ("google", "email"): normalize_google_email,
    ("google", "doc"): normalize_google_doc,
    ("google", "sheet"): normalize_google_sheet,
    ("google", "drive_file"): normalize_google_drive_file,
    ("google", "drive_folder"): normalize_google_drive_folder,
    ("microsoft", "email"): normalize_ms_email,
    ("microsoft", "office_doc"): normalize_ms_office_doc,
    ("microsoft", "office_sheet"): normalize_ms_office_sheet,
    ("microsoft", "office_slides"): normalize_ms_office_slides,
    ("microsoft", "drive_file"): normalize_ms_drive_file,
    ("microsoft", "drive_folder"): normalize_ms_drive_folder,
}


async def _site_url_for(session: AsyncSession, raw: RawArtifact) -> str | None:
    """For Jira: pull site_url from the matching Connection.extra so issue URLs render."""
    if raw.source != "jira":
        return None
    # raw.external_id is `{cloudId}:issue:{id}` or `{cloudId}:project:{id}`
    cloud_id = raw.external_id.split(":", 1)[0]
    result = await session.execute(
        select(Connection).where(
            Connection.source == "jira", Connection.account_id == cloud_id
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        return None
    return (conn.extra or {}).get("site_url")


async def normalize_pending(session: AsyncSession, batch_size: int = 200) -> dict[str, int]:
    """Run pending normalizations. Steps:
      1. Ensure the default project exists + auto-attach scopes for any new
         channel/project we've seen since last run.
      2. Pull raw_artifacts that have no matching artifacts row, oldest first.
      3. Dispatch to the per-source normalizer; skip + log unknown kinds.
    """
    project = await get_or_create_default_project(session)
    new_scopes = await auto_scope_from_raw_artifacts(session, project.id)

    # LEFT JOIN to find raw_artifacts with no artifacts row yet
    stmt = (
        select(RawArtifact)
        .outerjoin(Artifact, Artifact.raw_artifact_id == RawArtifact.id)
        .where(Artifact.id.is_(None))
        .order_by(RawArtifact.fetched_at.asc())
        .limit(batch_size)
    )
    result = await session.execute(stmt)
    pending = list(result.scalars().all())

    counts = {"considered": len(pending), "normalized": 0, "skipped": 0, "scopes_added": new_scopes}
    for raw in pending:
        fn = _DISPATCH.get((raw.source, raw.kind))
        if fn is None:
            counts["skipped"] += 1
            continue
        # Capture identifying fields BEFORE the call so we can log them even
        # if the session ends up in a rolled-back state after a failure.
        raw_id, raw_source, raw_kind = raw.id, raw.source, raw.kind
        try:
            if raw_source == "jira" and raw_kind == "issue":
                site_url = await _site_url_for(session, raw)
                await fn(session, raw, site_url=site_url)
            else:
                await fn(session, raw)
            await session.flush()  # surface PK violations now, per-row
            counts["normalized"] += 1
        except Exception as e:
            # Recover the session so the next iteration can run.
            await session.rollback()
            log.warning(
                "husn.graph.normalize.failed",
                raw_id=raw_id,
                source=raw_source,
                kind=raw_kind,
                error=type(e).__name__,
                msg=str(e)[:200],
            )
            counts["skipped"] += 1

    await session.commit()
    if counts["considered"] or counts["scopes_added"]:
        log.info("husn.graph.normalize.batch", **counts)
    return counts
