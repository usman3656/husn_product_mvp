"""Read endpoint for raw_artifacts — what the dashboard renders."""

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import RawArtifact
from husn.db.session import get_session

router = APIRouter(prefix="/api", tags=["artifacts"])


@router.get("/artifacts")
async def list_artifacts(
    source: str | None = Query(None, description="filter by source (slack/jira/google/microsoft)"),
    kind: str | None = Query(None, description="filter by kind (issue/project/message/email/...)"),
    limit: int = Query(50, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stmt = select(RawArtifact).order_by(desc(RawArtifact.fetched_at)).limit(limit)
    if source:
        stmt = stmt.where(RawArtifact.source == source)
    if kind:
        stmt = stmt.where(RawArtifact.kind == kind)
    result = await session.execute(stmt)
    rows = result.scalars().all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": r.id,
                "source": r.source,
                "kind": r.kind,
                "external_id": r.external_id,
                "fetched_at": r.fetched_at.isoformat(),
                "summary": _summarize(r),
            }
            for r in rows
        ],
    }


def _summarize(r: RawArtifact) -> dict[str, Any]:
    """Pull a small, source-specific subset of payload for list views.

    Step 2 will replace this with normalized graph projections; for now it's
    a hand-rolled adapter so the dashboard has something useful to render.
    """
    p = r.payload or {}
    if r.source == "jira" and r.kind == "issue":
        f = p.get("fields", {}) or {}
        status = (f.get("status") or {}).get("name")
        assignee = (f.get("assignee") or {}).get("displayName")
        return {
            "key": p.get("key"),
            "summary": f.get("summary"),
            "status": status,
            "assignee": assignee,
            "updated": f.get("updated"),
        }
    if r.source == "jira" and r.kind == "project":
        return {
            "key": p.get("key"),
            "name": p.get("name"),
            "type": p.get("projectTypeKey"),
        }
    if r.source == "slack" and r.kind == "message":
        text = (p.get("text") or "").strip()
        if len(text) > 140:
            text = text[:140] + "…"
        return {
            "channel": p.get("channel_name") or p.get("channel_id"),
            "author": p.get("user") or p.get("username") or p.get("bot_id"),
            "ts": p.get("ts"),
            "text": text,
        }
    if r.source == "slack" and r.kind == "channel":
        return {
            "name": p.get("name"),
            "id": p.get("id"),
            "is_member": p.get("is_member"),
            "members": p.get("num_members"),
        }
    if r.source == "slack" and r.kind == "user":
        prof = p.get("profile") or {}
        return {
            "id": p.get("id"),
            "name": p.get("real_name") or p.get("name") or prof.get("real_name"),
            "title": prof.get("title"),
        }
    if r.source == "google" and r.kind == "email":
        # Headers live in payload.payload.headers
        headers = ((p.get("payload") or {}).get("headers") or [])
        h = {(x.get("name") or "").lower(): x.get("value") for x in headers}
        return {
            "subject": h.get("subject"),
            "from": h.get("from"),
            "to": h.get("to"),
            "thread_id": p.get("threadId"),
            "snippet": (p.get("snippet") or "")[:160],
        }
    if r.source == "google" and r.kind == "doc":
        meta = p.get("drive_metadata") or {}
        doc = p.get("document") or {}
        return {
            "name": doc.get("title") or meta.get("name"),
            "modified": meta.get("modifiedTime"),
            "owner": (meta.get("owners") or [{}])[0].get("displayName"),
        }
    if r.source == "google" and r.kind == "sheet":
        meta = p.get("drive_metadata") or {}
        sp = p.get("spreadsheet") or {}
        return {
            "name": (sp.get("properties") or {}).get("title") or meta.get("name"),
            "sheets": len(sp.get("sheets") or []),
            "modified": meta.get("modifiedTime"),
        }
    if r.source == "google" and r.kind in ("drive_file", "drive_folder"):
        return {
            "name": p.get("name"),
            "mime_type": p.get("mimeType"),
            "modified": p.get("modifiedTime"),
        }
    return {"title": p.get("title") or p.get("name") or p.get("key") or r.external_id}
