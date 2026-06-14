"""Granola normalizer: raw_artifact -> Artifact (a meeting note).

Meeting notes have no natural channel/project scope, so each one lands in the
tenant's default project ('All work') — that's what the briefing dossier reads.
The meeting owner is resolved to a Person; attendees, when present, become
mention rows.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Artifact, ArtifactMention, RawArtifact
from husn.graph.identity import resolve_or_create_person
from husn.graph.projects import get_or_create_default_project
from husn.graph.tenancy_context import current_tenant_id


def _parse_dt(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _summary_text(summary: Any) -> str | None:
    """Granola summaries may be a markdown string or a structured object; reduce
    to readable text for the artifact body."""
    if summary is None:
        return None
    if isinstance(summary, str):
        return summary or None
    if isinstance(summary, dict):
        for key in ("markdown", "text", "content", "body"):
            v = summary.get(key)
            if isinstance(v, str) and v.strip():
                return v
        return None
    if isinstance(summary, list):
        parts = [p for p in (_summary_text(item) for item in summary) if p]
        return "\n\n".join(parts) or None
    return None


def _people(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw = payload.get("attendees") or payload.get("people") or payload.get("participants") or []
    return [p for p in raw if isinstance(p, dict)]


async def normalize_granola_meeting(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}

    # Meeting notes attach to the tenant's default project so the dossier
    # (which reads per-project) surfaces them in the briefing.
    project = await get_or_create_default_project(session, tenant_id=current_tenant_id.get())

    title = payload.get("title") or "Untitled meeting"
    body = _summary_text(payload.get("summary"))
    occurred_at = _parse_dt(payload.get("created_at") or payload.get("created") or payload.get("createdAt"))

    owner = payload.get("owner") or {}
    author_person_id: int | None = None
    owner_key = owner.get("id") or owner.get("email")
    if owner_key:
        person = await resolve_or_create_person(
            session,
            source="granola",
            source_user_id=str(owner_key),
            display_name=owner.get("name"),
            email=owner.get("email"),
        )
        author_person_id = person.id

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=project.id,
        source="granola",
        kind="meeting",
        external_id=raw.external_id,
        title=title,
        body=body,
        author_person_id=author_person_id,
        occurred_at=occurred_at,
        url=payload.get("url") or payload.get("html_url"),
        status=None,
        extra={"note_id": payload.get("id"), "owner": owner or None},
    )
    session.add(artifact)
    await session.flush()

    if author_person_id:
        session.add(
            ArtifactMention(artifact_id=artifact.id, person_id=author_person_id, kind="author")
        )

    # Attendees → mention rows (best-effort; many notes won't carry them).
    seen: set[str] = {str(owner_key)} if owner_key else set()
    for att in _people(payload):
        key = att.get("id") or att.get("email")
        if not key or str(key) in seen:
            continue
        seen.add(str(key))
        person = await resolve_or_create_person(
            session,
            source="granola",
            source_user_id=str(key),
            display_name=att.get("name"),
            email=att.get("email"),
        )
        session.add(
            ArtifactMention(artifact_id=artifact.id, person_id=person.id, kind="mention")
        )

    return artifact
