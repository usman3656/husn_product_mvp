"""Curated team directory — admin-managed names ↔ emails ↔ Slack IDs.

This is the SHORT list of people the Slack bot can email ("email Alice"), NOT
the auto-built `persons` table (which holds everyone who ever appeared in
ingested data). Admin adds/edits/deletes, and can one-click import the
workspace's members. Admin-only.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.db.models import DirectoryContact, Membership, PersonIdentity, User
from husn.db.session import get_session

router = APIRouter(prefix="/api/directory", tags=["directory"])


def _contacts_q(ctx: AuthContext):
    q = select(DirectoryContact)
    if ctx.tenant_id is not None:
        q = q.where(DirectoryContact.tenant_id == ctx.tenant_id)
    return q


@router.get("")
async def list_directory(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    rows = (await session.execute(_contacts_q(ctx).order_by(DirectoryContact.name))).scalars().all()
    return {
        "count": len(rows),
        "items": [
            {"id": c.id, "name": c.name, "email": c.email, "slack_user_id": c.slack_user_id}
            for c in rows
        ],
    }


class ContactIn(BaseModel):
    name: str
    email: str | None = None
    slack_user_id: str | None = None


@router.post("")
async def add_contact(
    body: ContactIn,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "name is required")
    c = DirectoryContact(
        tenant_id=ctx.tenant_id,
        name=name,
        email=(body.email or "").strip() or None,
        slack_user_id=(body.slack_user_id or "").strip() or None,
    )
    session.add(c)
    await session.commit()
    return {"id": c.id, "name": c.name, "email": c.email, "slack_user_id": c.slack_user_id}


class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    slack_user_id: str | None = None


async def _owned(contact_id: int, session: AsyncSession, ctx: AuthContext) -> DirectoryContact:
    c = await session.get(DirectoryContact, contact_id)
    if not c or (ctx.tenant_id is not None and c.tenant_id != ctx.tenant_id):
        raise HTTPException(404, "contact not found")
    return c


@router.patch("/{contact_id}")
async def update_contact(
    contact_id: int,
    body: ContactUpdate,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    c = await _owned(contact_id, session, ctx)
    if body.name is not None and body.name.strip():
        c.name = body.name.strip()
    if body.email is not None:
        c.email = body.email.strip() or None
    if body.slack_user_id is not None:
        c.slack_user_id = body.slack_user_id.strip() or None
    await session.commit()
    return {"id": c.id, "name": c.name, "email": c.email, "slack_user_id": c.slack_user_id}


@router.delete("/{contact_id}")
async def delete_contact(
    contact_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    c = await _owned(contact_id, session, ctx)
    await session.execute(sql_delete(DirectoryContact).where(DirectoryContact.id == c.id))
    await session.commit()
    return {"status": "ok"}


@router.post("/import")
async def import_members(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    """Seed the directory from the workspace's active members (the team). Adds a
    contact per member email not already present; fills name from the linked
    user and the Slack id from a matching Slack identity when known."""
    mq = select(Membership).where(Membership.status == "active")
    if ctx.tenant_id is not None:
        mq = mq.where(Membership.tenant_id == ctx.tenant_id)
    members = (await session.execute(mq)).scalars().all()

    existing = {
        (c.email or "").lower()
        for c in (await session.execute(_contacts_q(ctx))).scalars().all()
        if c.email
    }

    added = 0
    for m in members:
        if not m.email or m.email.lower() in existing:
            continue
        name = m.email
        if m.user_id is not None:
            u = await session.get(User, m.user_id)
            if u and u.name:
                name = u.name
        # best-effort Slack id from a matching ingested identity
        siq = select(PersonIdentity.source_user_id).where(
            PersonIdentity.source == "slack",
            func.lower(PersonIdentity.email) == m.email.lower(),
        )
        if ctx.tenant_id is not None:
            siq = siq.where(PersonIdentity.tenant_id == ctx.tenant_id)
        slack_uid = (await session.execute(siq.limit(1))).scalar_one_or_none()

        session.add(
            DirectoryContact(
                tenant_id=ctx.tenant_id, name=name, email=m.email, slack_user_id=slack_uid
            )
        )
        existing.add(m.email.lower())
        added += 1

    await session.commit()
    return {"status": "ok", "added": added}
