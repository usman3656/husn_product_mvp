import hashlib
import json
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import RawArtifact


def content_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def upsert_raw_artifact(
    session: AsyncSession,
    *,
    source: str,
    kind: str,
    external_id: str,
    payload: dict[str, Any],
    version: str = "1",
    tenant_id: int | None = None,
) -> int:
    """
    Idempotent insert keyed on (source, external_id, version).

    Returns the artifact id. If the row already exists with the same content_hash,
    it is left untouched; otherwise the payload + hash are updated.

    tenant_id comes from the owning Connection (TENANCY.md C3). None during the
    AUTH_REQUIRED=0 bridge; stamped on every row after the C4 cutover. The
    conflict target stays the GLOBAL (source, external_id, version) constraint
    until migration 0010 re-keys it per-tenant.
    """
    h = content_hash(payload)
    stmt = (
        insert(RawArtifact)
        .values(
            tenant_id=tenant_id,
            source=source,
            kind=kind,
            external_id=external_id,
            version=version,
            content_hash=h,
            payload=payload,
        )
        .on_conflict_do_update(
            constraint="uq_raw_artifact_source_extid_ver",
            set_={"content_hash": h, "payload": payload, "tenant_id": tenant_id},
        )
        .returning(RawArtifact.id)
    )
    result = await session.execute(stmt)
    return result.scalar_one()
