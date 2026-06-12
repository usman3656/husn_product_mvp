"""Per-row tenancy context for the normalize pipeline (TENANCY.md C3).

The 13 normalizers share a uniform `fn(session, raw)` signature and call
identity resolution internally. Rather than threading tenant_id through every
signature, the dispatcher (`normalize_pending`) sets this ContextVar from
`raw.tenant_id` before each row and resets it after. identity.py reads it.

Auto-stamping: SQLAlchemy `before_insert` listeners on the models that grow
a tenant_id but get constructed by normalizers (Artifact, ArtifactMention)
read the ContextVar at INSERT time. That way the normalizers never need to
know about tenancy — they keep their original signatures.

This is the ONLY ContextVar in the codebase and it is write-once-per-row in a
single dispatcher — do not extend the pattern to request handling (routers
must keep receiving tenant via AuthContext explicitly).
"""

from contextvars import ContextVar

from sqlalchemy import event

from husn.db.models import Artifact

current_tenant_id: ContextVar[int | None] = ContextVar("husn_current_tenant_id", default=None)


@event.listens_for(Artifact, "before_insert")
def _stamp_artifact_tenant(_mapper, _connection, target: Artifact) -> None:
    """Auto-stamp tenant_id on every Artifact insert from the normalize
    context. Migration 0010 made the column NOT NULL — without this the
    normalizers (which construct Artifact rows without passing tenant_id)
    would all NotNullViolationError after the cutover.
    """
    if target.tenant_id is None:
        target.tenant_id = current_tenant_id.get()
