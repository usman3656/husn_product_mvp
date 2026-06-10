"""Tenant scoping helper (TENANCY.md D6 layer 1).

Every router query against a tenant-scoped model goes through tenant_where().
Bridge mode (ctx.tenant_id is None, AUTH_REQUIRED=0) applies no filter so the
pre-cutover app behaves byte-identically. After C4 every context carries a
tenant and every query is filtered.

CI check (added with C4): no tenant-scoped model may be queried in a router
without this helper or an explicit tenant_id condition.
"""

from __future__ import annotations

from typing import Any, TypeVar

from husn.auth.deps import AuthContext

S = TypeVar("S")


def tenant_where(stmt: S, model: Any, ctx: AuthContext) -> S:
    """Append `model.tenant_id == ctx.tenant_id` unless in bridge mode."""
    if ctx.tenant_id is None:
        return stmt
    return stmt.where(model.tenant_id == ctx.tenant_id)  # type: ignore[attr-defined]


def stamp(obj: Any, ctx: AuthContext) -> Any:
    """Set obj.tenant_id from the context when present (insert paths)."""
    if ctx.tenant_id is not None and hasattr(obj, "tenant_id"):
        obj.tenant_id = ctx.tenant_id
    return obj
