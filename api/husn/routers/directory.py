"""People directory — admin-managed names ↔ emails ↔ Slack IDs.

This is what the Slack bot resolves recipients against ("email Alice" → her
address). Backed by the existing `persons` table (primary_email) joined to
Slack `person_identities`, so editing an email here immediately improves the
bot's resolution. Admin-only.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.db.models import Person, PersonIdentity
from husn.db.session import get_session

router = APIRouter(prefix="/api/directory", tags=["directory"])


def _person_q(ctx: AuthContext):
    q = select(Person)
    if ctx.tenant_id is not None:
        q = q.where(Person.tenant_id == ctx.tenant_id)
    return q


@router.get("")
async def list_directory(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    persons = (await session.execute(_person_q(ctx).order_by(Person.primary_name))).scalars().all()

    iq = select(PersonIdentity).where(PersonIdentity.source == "slack")
    if ctx.tenant_id is not None:
        iq = iq.where(PersonIdentity.tenant_id == ctx.tenant_id)
    slack_ids: dict[int, list[str]] = {}
    for ident in (await session.execute(iq)).scalars().all():
        slack_ids.setdefault(ident.person_id, []).append(ident.source_user_id)

    return {
        "count": len(persons),
        "items": [
            {
                "id": p.id,
                "name": p.primary_name,
                "email": p.primary_email,
                "slack_ids": slack_ids.get(p.id, []),
            }
            for p in persons
        ],
    }


class PersonUpdate(BaseModel):
    name: str | None = None
    email: str | None = None


@router.patch("/{person_id}")
async def update_person(
    person_id: int,
    body: PersonUpdate,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    p = await session.get(Person, person_id)
    if not p or (ctx.tenant_id is not None and p.tenant_id != ctx.tenant_id):
        raise HTTPException(404, "person not found")
    if body.email is not None:
        p.primary_email = body.email.strip() or None
    if body.name is not None and body.name.strip():
        p.primary_name = body.name.strip()
    await session.commit()
    return {"id": p.id, "name": p.primary_name, "email": p.primary_email}


class PersonCreate(BaseModel):
    name: str
    email: str | None = None


@router.post("")
async def add_person(
    body: PersonCreate,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "name is required")
    p = Person(
        tenant_id=ctx.tenant_id,
        primary_name=name,
        primary_email=(body.email or "").strip() or None,
    )
    session.add(p)
    await session.commit()
    return {"id": p.id, "name": p.primary_name, "email": p.primary_email}
