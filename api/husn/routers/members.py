"""Members directory — the admin panel API (TENANCY.md D3/D5).

Admin-provisioned membership: the admin adds (email, role) rows BEFORE the
person ever logs in. Login routes by email; the user row links lazily.

Anti-monitoring: responses carry name/email/role/status ONLY. No last-active,
no usage counts, no behavioral data — by design, including for admins.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.auth.emails import send_magic_link
from husn.auth.magic import create_login_token, normalize_email
from husn.auth.sessions import destroy_all_for_user
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Membership, User
from husn.db.session import get_session

router = APIRouter(prefix="/api/members", tags=["members"])

_VALID_ROLES = {"owner", "admin", "member"}


async def _count_active_owners(db: AsyncSession, tenant_id: int) -> int:
    rows = (
        await db.execute(
            select(Membership).where(
                Membership.tenant_id == tenant_id,
                Membership.role == "owner",
                Membership.status == "active",
            )
        )
    ).scalars().all()
    return len(rows)


def _row(m: Membership, user: User | None) -> dict[str, Any]:
    return {
        "id": m.id,
        "email": m.email,
        "name": user.name if user else None,
        "role": m.role,
        "status": m.status,  # invited (never logged in) | active
    }


@router.get("")
async def list_members(
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    if ctx.tenant_id is None:
        return {"count": 0, "items": []}
    rows = (
        await db.execute(
            select(Membership, User)
            .outerjoin(User, User.id == Membership.user_id)
            .where(
                Membership.tenant_id == ctx.tenant_id,
                Membership.status.in_(["invited", "active"]),
            )
            .order_by(Membership.created_at)
        )
    ).all()
    return {"count": len(rows), "items": [_row(m, u) for m, u in rows]}


class MemberAdd(BaseModel):
    email: EmailStr
    role: str = "member"
    notify: bool = True


@router.post("")
async def add_member(
    body: MemberAdd,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    if ctx.tenant_id is None:
        raise HTTPException(403, "no workspace selected")
    if body.role not in _VALID_ROLES:
        raise HTTPException(422, f"role must be one of {sorted(_VALID_ROLES)}")
    if body.role == "owner" and ctx.role != "owner":
        raise HTTPException(403, "only an owner can add another owner")
    email = normalize_email(body.email)

    existing = (
        await db.execute(
            select(Membership).where(
                Membership.tenant_id == ctx.tenant_id, Membership.email == email
            )
        )
    ).scalar_one_or_none()

    if existing is not None and existing.status in ("invited", "active"):
        raise HTTPException(409, "this email is already in the directory")

    if existing is not None:
        # Recycled-address rule (TENANCY.md D3): re-adding a removed email
        # reactivates the row but clears user_id/first_login_at, so the next
        # login creates/links fresh — old chat history is never auto-inherited.
        # (Reuse-the-row, not insert: uq_membership_tenant_email would reject
        # a second row for the same (tenant, email).)
        existing.role = body.role
        existing.status = "invited"
        existing.user_id = None
        existing.first_login_at = None
        existing.added_by = ctx.user_id
        m = existing
    else:
        m = Membership(
            tenant_id=ctx.tenant_id,
            email=email,
            role=body.role,
            status="invited",
            added_by=ctx.user_id,
        )
        db.add(m)
    await db.commit()

    if body.notify:
        raw = await create_login_token(db, email)
        link = f"{get_settings().public_web_base_url.rstrip('/')}/login/confirm?token={raw}"
        await send_magic_link(email, link)

    log.info("husn.members.added", tenant_id=ctx.tenant_id, role=body.role)
    return {"status": "ok", "member": _row(m, None)}


class MemberUpdate(BaseModel):
    role: str


@router.patch("/{membership_id}")
async def update_member(
    membership_id: int,
    body: MemberUpdate,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    if body.role not in _VALID_ROLES:
        raise HTTPException(422, f"role must be one of {sorted(_VALID_ROLES)}")
    m = await db.get(Membership, membership_id)
    if m is None or m.tenant_id != ctx.tenant_id or m.status == "removed":
        raise HTTPException(404, "member not found")

    # Only owners may grant or revoke the owner role — an admin cannot
    # escalate themselves (or anyone) to owner.
    if (body.role == "owner" or m.role == "owner") and ctx.role != "owner":
        raise HTTPException(403, "only an owner can change owner roles")

    if m.role == "owner" and body.role != "owner":
        if await _count_active_owners(db, ctx.tenant_id) <= 1:
            raise HTTPException(409, "cannot demote the last owner")

    m.role = body.role
    await db.commit()
    user = await db.get(User, m.user_id) if m.user_id else None
    return {"status": "ok", "member": _row(m, user)}


@router.delete("/{membership_id}")
async def remove_member(
    membership_id: int,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    m = await db.get(Membership, membership_id)
    if m is None or m.tenant_id != ctx.tenant_id or m.status == "removed":
        raise HTTPException(404, "member not found")

    if m.user_id is not None and m.user_id == ctx.user_id:
        raise HTTPException(409, "you cannot remove yourself — transfer ownership first")
    if m.role == "owner" and await _count_active_owners(db, ctx.tenant_id) <= 1:
        raise HTTPException(409, "cannot remove the last owner")

    m.status = "removed"
    await db.commit()

    # Kill every live session immediately (belt); per-request membership
    # re-validation in deps.py is the suspenders.
    killed = 0
    if m.user_id is not None:
        killed = await destroy_all_for_user(m.user_id)

    log.info(
        "husn.members.removed",
        tenant_id=ctx.tenant_id,
        membership_id=m.id,
        sessions_killed=killed,
    )
    return {"status": "ok"}
