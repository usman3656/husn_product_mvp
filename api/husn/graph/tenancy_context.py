"""Per-row tenancy context for the normalize pipeline (TENANCY.md C3).

The 13 normalizers share a uniform `fn(session, raw)` signature and call
identity resolution internally. Rather than threading tenant_id through every
signature, the dispatcher (`normalize_pending`) sets this ContextVar from
`raw.tenant_id` before each row and resets it after. identity.py reads it.

This is the ONLY ContextVar in the codebase and it is write-once-per-row in a
single dispatcher — do not extend the pattern to request handling (routers
must keep receiving tenant via AuthContext explicitly).
"""

from contextvars import ContextVar

current_tenant_id: ContextVar[int | None] = ContextVar("husn_current_tenant_id", default=None)
