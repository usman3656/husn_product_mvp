"""Google normalizer: raw_artifact -> Artifact + ArtifactMention rows."""

import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.backfill_gmail import gmail_header, gmail_plain_body
from husn.db.models import Artifact, ArtifactMention, RawArtifact
from husn.graph.identity import resolve_or_create_person
from husn.graph.projects import resolve_project_for


async def _add_mention(
    session: AsyncSession, *, artifact_id: int, person_id: int, kind: str
) -> None:
    """Idempotent ArtifactMention insert. The (artifact_id, person_id, kind)
    composite PK was failing on emails with the same address in To and Cc.
    """
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

_EMAIL_RE = re.compile(r"<([^>]+@[^>]+)>")
_BARE_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def _parse_from(header_value: str | None) -> tuple[str | None, str | None]:
    """Parse 'Name <email>' or 'email' into (display_name, email)."""
    if not header_value:
        return None, None
    m = _EMAIL_RE.search(header_value)
    if m:
        email = m.group(1).strip().lower()
        display = header_value[: m.start()].strip().strip('"').strip()
        return (display or None), email
    m2 = _BARE_EMAIL_RE.search(header_value)
    if m2:
        return None, m2.group(0).lower()
    return header_value.strip() or None, None


def _ms_to_dt(ms: str | int | None) -> datetime | None:
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=UTC)
    except (ValueError, TypeError):
        return None


def _iso_to_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# --- Email -----------------------------------------------------------------


async def normalize_google_email(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    pl = payload.get("payload") or {}
    subject = gmail_header(pl, "Subject")
    from_header = gmail_header(pl, "From")
    to_header = gmail_header(pl, "To")
    cc_header = gmail_header(pl, "Cc")
    date_header = gmail_header(pl, "Date")
    body = gmail_plain_body(pl)

    occurred_at = _ms_to_dt(payload.get("internalDate")) or _iso_to_dt(date_header)

    # Author = From
    author_person_id: int | None = None
    from_name, from_email = _parse_from(from_header)
    if from_email:
        person = await resolve_or_create_person(
            session,
            source="google",
            source_user_id=from_email,
            display_name=from_name,
            email=from_email,
        )
        author_person_id = person.id

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,  # email is not scoped to a project_source row today
        source="google",
        kind="email",
        external_id=raw.external_id,
        title=subject,
        body=body or None,
        author_person_id=author_person_id,
        occurred_at=occurred_at,
        url=None,
        status=",".join(payload.get("labelIds") or []) or None,
        extra={
            "thread_id": payload.get("threadId"),
            "snippet": payload.get("snippet"),
            "label_ids": payload.get("labelIds"),
            "size_estimate": payload.get("sizeEstimate"),
            "from": from_header,
            "to": to_header,
            "cc": cc_header,
        },
    )
    session.add(artifact)
    await session.flush()

    if author_person_id:
        await _add_mention(
            session, artifact_id=artifact.id, person_id=author_person_id, kind="author"
        )

    # Mentions: every distinct email address in To + Cc becomes an artifact_mention.
    # Dedupe in Python first (same address appearing in To and Cc is common) and
    # also rely on ON CONFLICT DO NOTHING at the SQL level for safety.
    seen_recipient_emails: set[str] = set()
    for header in (to_header, cc_header):
        if not header:
            continue
        for addr in _BARE_EMAIL_RE.findall(header):
            addr_l = addr.lower()
            if addr_l == from_email or addr_l in seen_recipient_emails:
                continue
            seen_recipient_emails.add(addr_l)
            person = await resolve_or_create_person(
                session,
                source="google",
                source_user_id=addr_l,
                display_name=None,
                email=addr_l,
            )
            await _add_mention(
                session, artifact_id=artifact.id, person_id=person.id, kind="mention"
            )

    return artifact


# --- Doc -------------------------------------------------------------------


def _doc_plain_text(doc: dict) -> str:
    """Walk Google Docs document JSON, extract plain text."""
    out: list[str] = []
    body = doc.get("body") or {}
    for elem in body.get("content") or []:
        para = elem.get("paragraph") or {}
        for run in para.get("elements") or []:
            tr = run.get("textRun") or {}
            text = tr.get("content")
            if text:
                out.append(text)
        # Tables, etc. — TODO if we hit them in real customer data
    return "".join(out).strip()


async def normalize_google_doc(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    meta = payload.get("drive_metadata") or {}
    doc = payload.get("document") or {}
    body = _doc_plain_text(doc) or None
    title = doc.get("title") or meta.get("name")

    # Author = first owner
    author_person_id: int | None = None
    owners = meta.get("owners") or []
    if owners:
        o = owners[0]
        email = (o.get("emailAddress") or "").lower() or None
        if email:
            person = await resolve_or_create_person(
                session,
                source="google",
                source_user_id=email,
                display_name=o.get("displayName"),
                email=email,
            )
            author_person_id = person.id

    project_id = await resolve_project_for(
        session,
        source="google",
        scope_kind="drive_folder",
        scope_id=payload.get("scope_folder_id") or "",
    )

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=project_id,
        source="google",
        kind="doc",
        external_id=raw.external_id,
        title=title,
        body=body,
        author_person_id=author_person_id,
        occurred_at=_iso_to_dt(meta.get("modifiedTime")),
        url=meta.get("webViewLink"),
        status=None,
        extra={
            "file_id": meta.get("id"),
            "mime_type": meta.get("mimeType"),
            "size": meta.get("size"),
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


# --- Sheet -----------------------------------------------------------------


def _sheet_summary_text(spreadsheet: dict) -> str:
    """Render a spreadsheet as readable text: per-sheet, the first non-empty
    rows joined with newlines. Skip empty cells. Capped at ~50 rows per sheet
    so the agent gets a representative sample without exploding context.
    """
    out: list[str] = []
    title = (spreadsheet.get("properties") or {}).get("title")
    if title:
        out.append(f"Spreadsheet: {title}")
    for s in spreadsheet.get("sheets") or []:
        s_title = (s.get("properties") or {}).get("title", "")
        out.append(f"\n## Sheet: {s_title}")
        # `data` contains a list of GridData; `rowData` is rows
        rows_emitted = 0
        for grid in s.get("data") or []:
            for row in grid.get("rowData") or []:
                if rows_emitted >= 50:
                    out.append("…")
                    break
                cells: list[str] = []
                for cell in row.get("values") or []:
                    fv = cell.get("formattedValue")
                    if fv:
                        cells.append(str(fv))
                if cells:
                    out.append(" | ".join(cells))
                    rows_emitted += 1
            if rows_emitted >= 50:
                break
    return "\n".join(out).strip()


async def normalize_google_sheet(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    meta = payload.get("drive_metadata") or {}
    spreadsheet = payload.get("spreadsheet") or {}
    title = (spreadsheet.get("properties") or {}).get("title") or meta.get("name")
    body = _sheet_summary_text(spreadsheet) or None

    author_person_id: int | None = None
    owners = meta.get("owners") or []
    if owners:
        o = owners[0]
        email = (o.get("emailAddress") or "").lower() or None
        if email:
            person = await resolve_or_create_person(
                session,
                source="google",
                source_user_id=email,
                display_name=o.get("displayName"),
                email=email,
            )
            author_person_id = person.id

    project_id = await resolve_project_for(
        session,
        source="google",
        scope_kind="drive_folder",
        scope_id=payload.get("scope_folder_id") or "",
    )

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=project_id,
        source="google",
        kind="sheet",
        external_id=raw.external_id,
        title=title,
        body=body,
        author_person_id=author_person_id,
        occurred_at=_iso_to_dt(meta.get("modifiedTime")),
        url=meta.get("webViewLink"),
        status=None,
        extra={
            "file_id": meta.get("id"),
            "mime_type": meta.get("mimeType"),
            "sheet_count": len(spreadsheet.get("sheets") or []),
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


# --- Generic Drive file + folder -------------------------------------------


async def normalize_google_drive_file(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,
        source="google",
        kind="drive_file",
        external_id=raw.external_id,
        title=payload.get("name"),
        body=None,
        author_person_id=None,
        occurred_at=_iso_to_dt(payload.get("modifiedTime")),
        url=payload.get("webViewLink"),
        status=None,
        extra={
            "file_id": payload.get("id"),
            "mime_type": payload.get("mimeType"),
            "size": payload.get("size"),
            "scope_folder_id": payload.get("scope_folder_id"),
        },
    )
    session.add(artifact)
    await session.flush()
    return artifact


async def normalize_google_drive_folder(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,
        source="google",
        kind="drive_folder",
        external_id=raw.external_id,
        title=payload.get("name"),
        body=None,
        author_person_id=None,
        occurred_at=_iso_to_dt(payload.get("modifiedTime")),
        url=payload.get("webViewLink"),
        status=None,
        extra={
            "file_id": payload.get("id"),
            "parent_scope_folder_id": payload.get("scope_folder_id"),
        },
    )
    session.add(artifact)
    await session.flush()
    return artifact
