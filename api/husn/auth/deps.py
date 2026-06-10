"""FastAPI auth dependencies — the role gates.

require_member()  → any active member of the session's active tenant.
                    Gates all tenant-scoped reads + chat.
require_admin()   → role ∈ {owner, admin}. Gates org mutations.

Both re-validate the membership row per request (status='active'), so an
admin removing someone takes effect immediately even if Redis session
cleanup races.

Bridge mode: while settings.auth_required is False (pre-C4), the gates
return a permissive AuthContext with tenant_id=None so existing unscoped
behavior continues unchanged. Queries written tenant-aware treat
tenant_id=None as "no filter" during the bridge.

CSRF: state-changing requests (non-GET/HEAD/OPTIONS) must carry the
X-Husn-Csrf header and an Origin matching PUBLIC_WEB_BASE_URL. Cookie
SameSite=Lax covers navigation; this covers XHR.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.sessions import COOKIE_NAME, read_session
from husn.core.config import get_settings
from husn.db.models import Membership, User
from husn.db.session import get_session

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass(slots=True)
class AuthContext:
    """Resolved caller. tenant_id None = bridge mode (auth not yet required)."""

    user_id: int | None
    email: str | None
    tenant_id: int | None
    role: str | None  # owner|admin|member|None (bridge)

    @property
    def is_admin(self) -> bool:
        return self.role in ("owner", "admin")


_BRIDGE = AuthContext(user_id=None, email=None, tenant_id=None, role=None)


def csrf_check(request: Request) -> None:
    """Reject cross-site state-changing requests.

    Called by the auth gates when auth is required, AND directly by the
    pre-auth login endpoints (magic send/consume, logout) — magic_consume in
    particular is login-CSRF-able without it (attacker's token + cross-site
    POST would silently sign the victim into the attacker's workspace).
    """
    if request.method in _SAFE_METHODS:
        return
    if not get_settings().auth_required:
        # Bridge mode: keep behavior byte-identical to pre-auth prod.
        return
    s = get_settings()
    origin = request.headers.get("origin")
    # Origin is absent on same-origin server-side calls (SSR via internal
    # http://api:8000) — those carry no browser ambient authority, so the
    # header requirement alone suffices there.
    if origin is not None and origin.rstrip("/") != s.public_web_base_url.rstrip("/"):
        raise HTTPException(403, "cross-origin request rejected")
    if request.headers.get("x-husn-csrf") != "1":
        raise HTTPException(403, "missing CSRF header")


# Backwards-compatible private alias used inside this module.
_csrf_check = csrf_check


async def _resolve(request: Request, db: AsyncSession) -> AuthContext:
    sid = request.cookies.get(COOKIE_NAME)
    if not sid:
        raise HTTPException(401, "not signed in")
    sess = await read_session(sid)
    if sess is None:
        raise HTTPException(401, "session expired")

    user_id = sess.get("user_id")
    tenant_id = sess.get("active_tenant_id")
    if user_id is None:
        raise HTTPException(401, "session invalid")

    if tenant_id is None:
        # Authenticated but no workspace selected/created yet.
        return AuthContext(user_id=user_id, email=sess.get("email"), tenant_id=None, role=None)

    membership = (
        await db.execute(
            select(Membership).where(
                Membership.user_id == user_id,
                Membership.tenant_id == tenant_id,
                Membership.status == "active",
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        # Removed (or never was) — the per-request check that makes admin
        # removal instant regardless of Redis session state.
        raise HTTPException(403, "no active membership in this workspace")

    return AuthContext(
        user_id=user_id,
        email=sess.get("email"),
        tenant_id=tenant_id,
        role=membership.role,
    )


async def require_user(
    request: Request, db: AsyncSession = Depends(get_session)
) -> AuthContext:
    """Authenticated user; workspace NOT required (create-workspace flow)."""
    if not get_settings().auth_required:
        # Bridge mode: still resolve a session if present (lets the founder
        # test login pre-cutover) but never block.
        sid = request.cookies.get(COOKIE_NAME)
        if sid:
            try:
                return await _resolve(request, db)
            except HTTPException:
                return _BRIDGE
        return _BRIDGE
    _csrf_check(request)
    return await _resolve(request, db)


async def require_member(
    request: Request, db: AsyncSession = Depends(get_session)
) -> AuthContext:
    """Active member of the session's active workspace."""
    ctx = await require_user(request, db)
    if not get_settings().auth_required:
        return ctx
    if ctx.tenant_id is None:
        raise HTTPException(403, "no workspace selected")
    return ctx


async def require_admin(
    request: Request, db: AsyncSession = Depends(get_session)
) -> AuthContext:
    """Owner or admin of the active workspace."""
    ctx = await require_member(request, db)
    if not get_settings().auth_required:
        return ctx
    if not ctx.is_admin:
        raise HTTPException(403, "admin role required")
    return ctx


async def touch_last_login(db: AsyncSession, user: User) -> None:
    """Security-audit timestamp ONLY — rendered nowhere in product UI."""
    user.last_login_at = datetime.now(UTC)
    await db.commit()
