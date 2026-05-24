"""Top-level google_backfill — incremental sync via Gmail history + Drive changes.

On first call for a connection (no cursor stored), the underlying sync
functions fall back to a full backfill and capture the cursor. Subsequent
calls only fetch what actually changed since the last cursor — close to
zero API cost when nothing has happened.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.sync_drive import sync_drive
from husn.connectors.google.sync_gmail import sync_gmail
from husn.core.logging import log
from husn.db.models import Connection


async def get_connections(session: AsyncSession) -> list[Connection]:
    result = await session.execute(select(Connection).where(Connection.source == "google"))
    return list(result.scalars().all())


async def backfill_connection(session: AsyncSession, connection: Connection) -> dict[str, int]:
    gmail_counts = await sync_gmail(session, connection)
    drive_counts = await sync_drive(session, connection)
    merged = {
        **{f"gmail_{k}": v for k, v in gmail_counts.items()},
        **{f"drive_{k}": v for k, v in drive_counts.items()}
    }
    log.info("husn.google.sync.done", account_id=connection.account_id, **merged)
    return merged
