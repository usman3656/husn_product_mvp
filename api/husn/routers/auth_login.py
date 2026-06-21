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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, csrf_check, require_user
from husn.auth.emails import send_magic_link
from husn.auth.magic import (
    consume_login_token,
    create_login_token,
    normalize_email,
    rate_limit_ok,
)
from husn.auth.passwords import (
    CredentialError,
    dummy_verify,
    hash_password,
    login_attempt_ok,
    normalize_username,
    reset_login_attempts,
    validate_password,
    validate_username,
    verify_password,
)
from husn.auth.sessions import (
    COOKIE_NAME,
    create_session,
    destroy_all_for_user,
    destroy_session,
    read_session,
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
    # When we scope the session cookie to a parent domain (.husn.io), proactively
    # delete any stale HOST-ONLY husn_session left from before COOKIE_DOMAIN was
    # set. Otherwise the browser keeps BOTH and may send/read the dead one → 401
    # even right after this fresh login. (deps._session_ids also tolerates this
    # at read time; this clears it at the source.)
    if s.cookie_domain:
        response.delete_cookie(COOKIE_NAME, domain=None, path="/")
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
    # Also clear the host-only variant so a stale duplicate can't survive logout.
    if s.cookie_domain:
        response.delete_cookie(COOKIE_NAME, domain=None, path="/")


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


async def _login_and_fork(
    db: AsyncSession, response: Response, user: User
) -> dict[str, Any]:
    """Create a session for `user`, set the cookie, and return the membership
    fork shared by magic-link consume and password login:
      one active workspace  → {status: ok, workspace}
      several               → {status: pick_workspace, memberships}
      none                  → {status: no_workspace, email}
    """
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
        sid = await create_session(user.id, user.email, active_tenant_id=t.id)
        _set_cookie(response, sid)
        return {"status": "ok", "workspace": {"tenant_id": t.id, "name": t.name, "role": m.role}}

    sid = await create_session(user.id, user.email, active_tenant_id=None)
    _set_cookie(response, sid)
    if len(memberships) == 0:
        return {"status": "no_workspace", "email": user.email}
    return {"status": "pick_workspace", "memberships": _membership_payload(memberships)}


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
    return await _login_and_fork(db, response, user)


# ---------------- username + password credential ----------------


class PasswordLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login/password")
async def password_login(
    body: PasswordLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Sign in with username + password. Same membership fork as magic consume.

    Login-CSRF guarded (like magic consume). Generic error on any failure — no
    username enumeration — and a dummy hash on missing user/credential so the
    response time doesn't reveal which usernames exist.
    """
    csrf_check(request)
    username = normalize_username(body.username)
    if not username or not body.password:
        raise HTTPException(401, "invalid username or password")
    if not await login_attempt_ok(username):
        raise HTTPException(429, "too many attempts — wait a few minutes and try again")

    user = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if user is None or user.password_hash is None:
        dummy_verify()  # equalize timing with the real-verify path
        raise HTTPException(401, "invalid username or password")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "invalid username or password")

    await reset_login_attempts(username)
    user.last_login_at = datetime.now(UTC)  # security audit only; never rendered
    await db.commit()
    log.info("husn.auth.password_login", user_id=user.id)
    return await _login_and_fork(db, response, user)


class PasswordSetupRequest(BaseModel):
    username: str
    password: str


@router.post("/password/setup")
async def password_setup(
    body: PasswordSetupRequest,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_user),
) -> dict[str, Any]:
    """First-time setup of the username+password credential, for a signed-in
    user. The username is set ONCE and cannot be changed afterwards (use the
    email magic link to recover, then change the password here)."""
    if ctx.user_id is None:
        raise HTTPException(401, "sign in first")
    user = await db.get(User, ctx.user_id)
    if user is None:
        raise HTTPException(401, "sign in first")
    if user.username is not None:
        raise HTTPException(409, "username is already set and cannot be changed")

    try:
        username = validate_username(body.username)
        validate_password(body.password)
    except CredentialError as e:
        raise HTTPException(422, str(e)) from e

    taken = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(409, "that username is taken")

    user.username = username
    user.password_hash = hash_password(body.password)
    user.password_set_at = datetime.now(UTC)
    try:
        await db.commit()
    except IntegrityError as e:
        # Lost the race against a concurrent claim of the same username — the
        # DB unique constraint is the source of truth; surface it cleanly.
        await db.rollback()
        raise HTTPException(409, "that username is taken") from e
    log.info("husn.auth.password_setup", user_id=user.id)
    return {"status": "ok", "username": username}


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/password/change")
async def password_change(
    body: PasswordChangeRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_user),
) -> dict[str, Any]:
    """Change the password (requires the current one). Username is unchanged.

    Revokes every existing session for the user (so a stolen session can't
    survive a password reset) and re-issues a fresh one for the caller.
    """
    if ctx.user_id is None:
        raise HTTPException(401, "sign in first")
    user = await db.get(User, ctx.user_id)
    if user is None or user.password_hash is None:
        raise HTTPException(409, "no password set yet — set one up first")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(403, "current password is incorrect")

    try:
        validate_password(body.new_password)
    except CredentialError as e:
        raise HTTPException(422, str(e)) from e

    user.password_hash = hash_password(body.new_password)
    user.password_set_at = datetime.now(UTC)
    await db.commit()

    # Preserve the caller's active workspace, then kill all sessions and mint a
    # fresh one so this device stays signed in while every other session dies.
    old_sid = request.cookies.get(COOKIE_NAME)
    active_tenant_id = None
    if old_sid:
        old = await read_session(old_sid)
        if old:
            active_tenant_id = old.get("active_tenant_id")
    await destroy_all_for_user(user.id)
    sid = await create_session(user.id, user.email, active_tenant_id=active_tenant_id)
    _set_cookie(response, sid)

    log.info("husn.auth.password_change", user_id=user.id)
    return {"status": "ok"}


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

    user = await db.get(User, ctx.user_id)
    return {
        "authenticated": True,
        "auth_required": get_settings().auth_required,
        "user": {
            "id": ctx.user_id,
            "email": ctx.email,
            "username": user.username if user else None,
            "has_password": bool(user and user.password_hash),
        },
        "workspace": workspace,
    }
