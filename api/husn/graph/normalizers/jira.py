"""Jira normalizer: raw_artifact -> Artifact + ArtifactMention rows."""

from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Artifact, ArtifactMention, RawArtifact
from husn.graph.identity import resolve_or_create_person
from husn.graph.projects import resolve_project_for


def _parse_jira_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    # Jira returns e.g. "2026-05-23T23:16:20.984+0100"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _site_url_from_extra(extra: dict | None) -> str | None:
    if not extra:
        return None
    return (extra or {}).get("site_url")


async def normalize_jira_issue(
    session: AsyncSession, raw: RawArtifact, site_url: str | None = None
) -> Artifact:
    payload = raw.payload or {}
    fields = payload.get("fields") or {}

    project_key = (fields.get("project") or {}).get("key")
    project_id = await resolve_project_for(
        session, source="jira", scope_kind="project", scope_id=project_key
    )

    title = fields.get("summary")
    desc = fields.get("description")
    body: str | None = None
    if isinstance(desc, dict):  # ADF document
        body = _extract_text_from_adf(desc)
    elif isinstance(desc, str):
        body = desc

    status_name = ((fields.get("status") or {}).get("name")) if fields else None
    issue_key = payload.get("key")
    url = f"{site_url}/browse/{issue_key}" if site_url and issue_key else None

    # Author + assignee resolution
    author_person_id: int | None = None
    creator = fields.get("creator") or fields.get("reporter")
    if isinstance(creator, dict) and creator.get("accountId"):
        person = await resolve_or_create_person(
            session,
            source="jira",
            source_user_id=creator["accountId"],
            display_name=creator.get("displayName"),
            email=creator.get("emailAddress"),
            extra={"jira_account_type": creator.get("accountType")},
        )
        author_person_id = person.id

    assignee_person_id: int | None = None
    assignee = fields.get("assignee")
    if isinstance(assignee, dict) and assignee.get("accountId"):
        person = await resolve_or_create_person(
            session,
            source="jira",
            source_user_id=assignee["accountId"],
            display_name=assignee.get("displayName"),
            email=assignee.get("emailAddress"),
        )
        assignee_person_id = person.id

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=project_id,
        source="jira",
        kind="issue",
        external_id=raw.external_id,
        title=title,
        body=body,
        author_person_id=author_person_id,
        occurred_at=_parse_jira_dt(fields.get("updated") or fields.get("created")),
        url=url,
        status=status_name,
        extra={
            "key": issue_key,
            "project_key": project_key,
            "issuetype": ((fields.get("issuetype") or {}).get("name")),
            "priority": ((fields.get("priority") or {}).get("name")),
            "created": fields.get("created"),
            "updated": fields.get("updated"),
            "duedate": fields.get("duedate"),
        },
    )
    session.add(artifact)
    await session.flush()

    mentions: list[ArtifactMention] = []
    if author_person_id:
        mentions.append(
            ArtifactMention(artifact_id=artifact.id, person_id=author_person_id, kind="author")
        )
    if assignee_person_id:
        mentions.append(
            ArtifactMention(artifact_id=artifact.id, person_id=assignee_person_id, kind="assignee")
        )
    for m in mentions:
        session.add(m)

    return artifact


async def normalize_jira_project(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,  # the husn project, not the jira project, lives in project_sources
        source="jira",
        kind="project",
        external_id=raw.external_id,
        title=payload.get("name"),
        body=payload.get("description"),
        occurred_at=None,
        url=payload.get("self"),
        status=payload.get("style"),
        extra={
            "key": payload.get("key"),
            "projectTypeKey": payload.get("projectTypeKey"),
            "lead": (payload.get("lead") or {}).get("displayName"),
        },
    )
    session.add(artifact)
    await session.flush()
    return artifact


def _extract_text_from_adf(doc: dict) -> str:
    """Best-effort plain-text extraction from Atlassian Document Format."""
    out: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text" and "text" in node:
                out.append(node["text"])
            for child in node.get("content") or []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(doc)
    return " ".join(out).strip() or None  # type: ignore[return-value]
