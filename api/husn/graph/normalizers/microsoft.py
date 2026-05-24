"""Microsoft normalizer: raw_artifact -> Artifact + ArtifactMention rows.

Outlook email body comes from Graph as either text or HTML (content type
declared in `body.contentType`). HTML is stripped with the same regex used
elsewhere in the codebase.
"""

import re
from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Artifact, ArtifactMention, RawArtifact
from husn.graph.identity import resolve_or_create_person
from husn.graph.projects import resolve_project_for

_HTML_TAG_RE = re.compile(r"<[^>]+>")


async def _add_mention(
    session: AsyncSession, *, artifact_id: int, person_id: int, kind: str
) -> None:
    await session.execute(
        pg_insert(ArtifactMention)
        .values(artifact_id=artifact_id, person_id=person_id, kind=kind)
        .on_conflict_do_nothing(
            index_elements=[
                ArtifactMention.artifact_id,
                ArtifactMention.person_id,
                ArtifactMention.kind,
            ]
        )
    )


def _iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _email_text(body_field: dict | None) -> str:
    if not body_field:
        return ""
    content = body_field.get("content") or ""
    if (body_field.get("contentType") or "").lower() == "html":
        return _HTML_TAG_RE.sub(" ", content).strip()
    return content.strip()


def _person_from_recipient(rec: dict[str, Any]) -> tuple[str | None, str | None]:
    """Returns (display_name, email) from a Microsoft Graph EmailAddress block."""
    addr = rec.get("emailAddress") or {}
    email = (addr.get("address") or "").lower() or None
    name = addr.get("name") or None
    return name, email


# --- Outlook email --------------------------------------------------------


async def normalize_ms_email(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    subject = payload.get("subject")
    body = _email_text(payload.get("body")) or payload.get("bodyPreview")
    occurred = _iso(payload.get("receivedDateTime") or payload.get("sentDateTime"))

    # Author = from
    from_block = payload.get("from") or {}
    from_name, from_email = _person_from_recipient(from_block)
    author_person_id: int | None = None
    if from_email:
        person = await resolve_or_create_person(
            session,
            source="microsoft",
            source_user_id=from_email,
            display_name=from_name,
            email=from_email,
        )
        author_person_id = person.id

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,  # email not folder-scoped to a project in v1 (Outlook folders ARE the scope)
        source="microsoft",
        kind="email",
        external_id=raw.external_id,
        title=subject,
        body=body or None,
        author_person_id=author_person_id,
        occurred_at=occurred,
        url=None,
        status=",".join(payload.get("categories") or []) or None,
        extra={
            "conversation_id": payload.get("conversationId"),
            "folder_id": payload.get("folder_id"),
            "internet_message_id": payload.get("internetMessageId"),
            "is_read": payload.get("isRead"),
            "from": from_block,
            "to": payload.get("toRecipients"),
            "cc": payload.get("ccRecipients"),
        },
    )
    session.add(artifact)
    await session.flush()

    if author_person_id:
        await _add_mention(
            session, artifact_id=artifact.id, person_id=author_person_id, kind="author"
        )

    # Mentions: each distinct To + Cc address
    seen: set[str] = set()
    for rec_list_key in ("toRecipients", "ccRecipients"):
        for rec in payload.get(rec_list_key) or []:
            _, email = _person_from_recipient(rec)
            if not email or email == from_email or email in seen:
                continue
            seen.add(email)
            p = await resolve_or_create_person(
                session,
                source="microsoft",
                source_user_id=email,
                display_name=(rec.get("emailAddress") or {}).get("name"),
                email=email,
            )
            await _add_mention(
                session, artifact_id=artifact.id, person_id=p.id, kind="mention"
            )

    return artifact


# --- OneDrive file (Office or generic) ------------------------------------


async def _normalize_ms_drive_file(
    session: AsyncSession, raw: RawArtifact, *, kind: str
) -> Artifact:
    payload = raw.payload or {}

    # Author = createdBy.user
    author_person_id: int | None = None
    creator = (payload.get("createdBy") or {}).get("user") or {}
    email = (creator.get("email") or "").lower() or None
    if email:
        p = await resolve_or_create_person(
            session,
            source="microsoft",
            source_user_id=email,
            display_name=creator.get("displayName"),
            email=email,
        )
        author_person_id = p.id

    project_id = await resolve_project_for(
        session,
        source="microsoft",
        scope_kind="onedrive_folder",
        scope_id=payload.get("scope_folder_id") or "",
    )

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=project_id,
        source="microsoft",
        kind=kind,
        external_id=raw.external_id,
        title=payload.get("name"),
        body=payload.get("_extracted_text") or None,
        author_person_id=author_person_id,
        occurred_at=_iso(payload.get("lastModifiedDateTime")),
        url=payload.get("webUrl"),
        status=None,
        extra={
            "file_id": payload.get("id"),
            "size": payload.get("size"),
            "scope_folder_id": payload.get("scope_folder_id"),
        },
    )
    session.add(artifact)
    await session.flush()
    if author_person_id:
        await _add_mention(
            session, artifact_id=artifact.id, person_id=author_person_id, kind="author"
        )
    return artifact


async def normalize_ms_office_doc(session: AsyncSession, raw: RawArtifact) -> Artifact:
    return await _normalize_ms_drive_file(session, raw, kind="office_doc")


async def normalize_ms_office_sheet(session: AsyncSession, raw: RawArtifact) -> Artifact:
    return await _normalize_ms_drive_file(session, raw, kind="office_sheet")


async def normalize_ms_office_slides(session: AsyncSession, raw: RawArtifact) -> Artifact:
    return await _normalize_ms_drive_file(session, raw, kind="office_slides")


async def normalize_ms_drive_file(session: AsyncSession, raw: RawArtifact) -> Artifact:
    return await _normalize_ms_drive_file(session, raw, kind="drive_file")


async def normalize_ms_drive_folder(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,
        source="microsoft",
        kind="drive_folder",
        external_id=raw.external_id,
        title=payload.get("name"),
        body=None,
        author_person_id=None,
        occurred_at=_iso(payload.get("lastModifiedDateTime")),
        url=payload.get("webUrl"),
        status=None,
        extra={
            "file_id": payload.get("id"),
            "parent_scope_folder_id": payload.get("scope_folder_id"),
        },
    )
    session.add(artifact)
    await session.flush()
    return artifact
