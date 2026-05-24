"""Top-level microsoft_backfill — delta-aware for both Outlook and OneDrive.

Both surfaces use Microsoft Graph's `/delta` endpoints. First call returns
a `@odata.deltaLink` cursor stored on `connection.extra`; subsequent calls
use that link and return only what changed. Empty body = no work to do.

Cursors live on connection.extra:
  outlook_deltas:   { <folder_id>: <delta_link> }  — one per allowlisted folder
  drive_delta_link: <link>                          — one root cursor
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.microsoft.backfill_outlook import backfill_outlook
from husn.connectors.microsoft.sync_drive import sync_drive
from husn.core.logging import log
from husn.db.models import Connection


async def get_connections(session: AsyncSession) -> list[Connection]:
    result = await session.execute(
        select(Connection).where(Connection.source == "microsoft")
    )
    return list(result.scalars().all())


async def backfill_connection(
    session: AsyncSession, connection: Connection
) -> dict[str, int]:
    outlook_counts = await backfill_outlook(session, connection)
    drive_counts = await sync_drive(session, connection)
    merged = {
        **{f"outlook_{k}": v for k, v in outlook_counts.items()},
        **{f"drive_{k}": v for k, v in drive_counts.items()},
    }
    log.info(
        "husn.microsoft.sync.done", account_id=connection.account_id, **merged
    )
    return merged
