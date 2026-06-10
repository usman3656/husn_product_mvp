"""User authentication — magic-link login, sessions, workspace creation.

Flow (TENANCY.md D4):
  POST /auth/login/magic            {email}  → send link (always 200; no enumeration)
  POST /auth/login/magic/consume    {token}  → verify + JIT user + memberships
                                               → session cookie + next-step status
  POST /auth/workspace              {name}   → create tenant; caller becomes owner
  POST /auth/workspace/select       {tenant_id} → switch active workspace
  POST /auth/logout
  GET  /auth/me

The login fork happens AFTER email verification (Atlassian/Notion pattern):
consume returns status ∈ {ok, pick_workspace, no_workspace} and the web
renders the matching screen.
"""

from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, csrf_check, require_user
from husn.auth.emails import send_magic_link
from husn.auth.magic import (
    consume_login_token,
    create_login_token,
    normalize_email,
    rate_limit_ok,
)
from husn.auth.sessions import (
    COOKIE_NAME,
    create_session,
    destroy_session,
    update_session,
)
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Membership, Tenant, User
from husn.db.session import get_session

router = APIRouter(prefix="/auth", tags=["auth-login"])


# ---------------- helpers ----------------


def _set_cookie(response: Response, sid: str) -> None:
    s = get_settings()
    response.set_cookie(
        key=COOKIE_NAME,
        value=sid,
        max_age=s.session_ttl_days * 86400,
        httponly=True,
        secure=s.env != "local",
        samesite="lax",
        domain=s.cookie_domain or None,
        path="/",
    )


def _clear_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(COOKIE_NAME, domain=s.cookie_domain or None, path="/")


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")[:48] or "workspace"
    return base


async def _memberships_for_email(db: AsyncSession, email: str) -> list[Membership]:
    rows = (
        await db.execute(
            select(Membership).where(
                Membership.email == email,
                Membership.status.in_(["invited", "active"]),
            )
        )
    ).scalars().all()
    return list(rows)


async def _jit_user(db: AsyncSession, email: str) -> User:
    """Find-or-create the user row (JIT on first login) + link any directory
    rows that were waiting for this email."""
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email)
        db.add(user)
        await db.flush()

    user.last_login_at = datetime.now(UTC)  # security audit only; never rendered

    now = datetime.now(UTC)
    for m in await _memberships_for_email(db, email):
        if m.user_id is None:
            m.user_id = user.id
        if m.status == "invited":
            m.status = "active"
            m.first_login_at = now

    await db.commit()
    return user


def _membership_payload(db_rows: list[tuple[Membership, Tenant]]) -> list[dict[str, Any]]:
    return [
        {"tenant_id": t.id, "name": t.name, "slug": t.slug, "role": m.role}
        for m, t in db_rows
    ]


# ---------------- endpoints ----------------


class MagicRequest(BaseModel):
    email: EmailStr


@router.post("/login/magic")
async def magic_send(
    body: MagicRequest, request: Request, db: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    csrf_check(request)
    email = normalize_email(body.email)
    if not await rate_limit_ok(email):
        # Same response shape as success — no enumeration, no oracle.
        return {"status": "sent"}
    raw = await create_login_token(db, email)
    link = f"{get_settings().public_web_base_url.rstrip('/')}/login/confirm?token={raw}"
    await send_magic_link(email, link)
    return {"status": "sent"}


class ConsumeRequest(BaseModel):
    token: str


@router.post("/login/magic/consume")
async def magic_consume(
    body: ConsumeRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    # Login-CSRF guard: without this, an attacker could POST their own token
    # cross-site and silently sign the victim into the attacker's workspace.
    csrf_check(request)
    email = await consume_login_token(db, body.token)
    if email is None:
        raise HTTPException(400, "invalid or expired link")

    user = await _jit_user(db, email)

    rows = (
        await db.execute(
            select(Membership, Tenant)
            .join(Tenant, Tenant.id == Membership.tenant_id)
            .where(Membership.user_id == user.id, Membership.status == "active")
        )
    ).all()
    memberships = [(m, t) for m, t in rows]

    if len(memberships) == 1:
        m, t = memberships[0]
        sid = await create_session(user.id, email, active_tenant_id=t.id)
        _set_cookie(response, sid)
        return {"status": "ok", "workspace": {"tenant_id": t.id, "name": t.name, "role": m.role}}

    sid = await create_session(user.id, email, active_tenant_id=None)
    _set_cookie(response, sid)
    if len(memberships) == 0:
        return {"status": "no_workspace", "email": email}
    return {"status": "pick_workspace", "memberships": _membership_payload(memberships)}


class WorkspaceCreate(BaseModel):
    name: str


@router.post("/workspace")
async def workspace_create(
    body: WorkspaceCreate,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_user),
) -> dict[str, Any]:
    if ctx.user_id is None:
        raise HTTPException(401, "sign in first")
    name = body.name.strip()
    if not (2 <= len(name) <= 100):
        raise HTTPException(422, "workspace name must be 2-100 characters")

    slug = _slugify(name)
    exists = (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
    if exists is not None:
        slug = f"{slug}-{secrets.token_hex(3)}"

    tenant = Tenant(name=name, slug=slug)
    db.add(tenant)
    await db.flush()

    db.add(
        Membership(
            tenant_id=tenant.id,
            email=ctx.email or "",
            role="owner",
            user_id=ctx.user_id,
            status="active",
            first_login_at=datetime.now(UTC),
        )
    )
    await db.commit()

    sid = request.cookies.get(COOKIE_NAME)
    if sid:
        await update_session(sid, active_tenant_id=tenant.id)

    log.info("husn.auth.workspace_created", tenant_id=tenant.id, slug=slug)
    return {"status": "ok", "workspace": {"tenant_id": tenant.id, "name": tenant.name, "role": "owner"}}


class WorkspaceSelect(BaseModel):
    tenant_id: int


@router.post("/workspace/select")
async def workspace_select(
    body: WorkspaceSelect,
    request: Request,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_user),
) -> dict[str, Any]:
    if ctx.user_id is None:
        raise HTTPException(401, "sign in first")
    m = (
        await db.execute(
            select(Membership).where(
                Membership.user_id == ctx.user_id,
                Membership.tenant_id == body.tenant_id,
                Membership.status == "active",
            )
        )
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(403, "not a member of that workspace")
    sid = request.cookies.get(COOKIE_NAME)
    if sid:
        await update_session(sid, active_tenant_id=body.tenant_id)
    return {"status": "ok"}


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, Any]:
    csrf_check(request)
    sid = request.cookies.get(COOKIE_NAME)
    if sid:
        await destroy_session(sid)
    _clear_cookie(response)
    return {"status": "ok"}


@router.get("/me")
async def me(
    request: Request,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_user),
) -> dict[str, Any]:
    if ctx.user_id is None:
        # Bridge mode (auth not yet required) with no session.
        return {"authenticated": False, "auth_required": get_settings().auth_required}

    workspace = None
    if ctx.tenant_id is not None:
        t = await db.get(Tenant, ctx.tenant_id)
        if t:
            workspace = {"tenant_id": t.id, "name": t.name, "slug": t.slug, "role": ctx.role}

    return {
        "authenticated": True,
        "auth_required": get_settings().auth_required,
        "user": {"id": ctx.user_id, "email": ctx.email},
        "workspace": workspace,
    }
