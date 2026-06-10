"""Admin diagnostics — run things inline so the founder (or me from a curl)
can see WHY a backfill produced no rows. Worker-side execution catches
exceptions and logs them but does not surface anything outside the
container; these endpoints execute the same call paths in the api process,
catch exceptions, and return them as JSON.

This is a Stage-1 utility. Once tenancy + admin auth land in Stage 2 these
endpoints get scoped to admin users.
"""

from __future__ import annotations

import traceback
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.auth.scope import tenant_where
from husn.connectors.google.backfill import backfill_connection as google_backfill_connection
from husn.connectors.jira.backfill import backfill_connection as jira_backfill_connection
from husn.connectors.microsoft.backfill import backfill_connection as microsoft_backfill_connection
from husn.connectors.slack.backfill import backfill_connection as slack_backfill_connection
from husn.core.logging import log
from husn.db.models import Connection
from husn.db.session import get_session

router = APIRouter(prefix="/api/admin", tags=["admin-diag"])


_BACKFILL_FN = {
    "jira": jira_backfill_connection,
    "slack": slack_backfill_connection,
    "google": google_backfill_connection,
    "microsoft": microsoft_backfill_connection,
}


async def _run_one(
    session: AsyncSession, conn: Connection
) -> dict[str, Any]:
    fn = _BACKFILL_FN.get(conn.source)
    if fn is None:
        return {
            "source": conn.source,
            "connection_id": conn.id,
            "ok": False,
            "error": f"no backfill function registered for {conn.source}",
        }
    try:
        summary = await fn(session, conn)
        await session.commit()
        return {
            "source": conn.source,
            "connection_id": conn.id,
            "ok": True,
            "summary": summary,
        }
    except Exception as e:
        await session.rollback()
        tb = traceback.format_exc(limit=8)
        log.exception(
            "husn.admin.backfill_now.failed",
            source=conn.source,
            connection_id=conn.id,
        )
        return {
            "source": conn.source,
            "connection_id": conn.id,
            "ok": False,
            "error": f"{type(e).__name__}: {e}"[:400],
            "traceback": tb,
        }


@router.post("/backfill-now")
async def backfill_now(
    source: str | None = None,
    connection_id: int | None = None,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict[str, Any]:
    """Run backfills inline. Returns per-connection result with full
    exception traceback on failure.

    Query params:
      source         optional: limit to one source (jira/slack/google/microsoft)
      connection_id  optional: limit to one specific Connection row
    """
    q = tenant_where(select(Connection), Connection, ctx)
    if source is not None:
        q = q.where(Connection.source == source)
    if connection_id is not None:
        q = q.where(Connection.id == connection_id)
    conns = (await session.execute(q.order_by(Connection.id))).scalars().all()

    out: list[dict[str, Any]] = []
    for c in conns:
        out.append(await _run_one(session, c))

    return {
        "ran": len(out),
        "items": out,
    }
