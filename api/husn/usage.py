"""Token-usage ledger + sync-setting helpers."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import SyncSetting, TokenUsage

VALID_SOURCES = {"agent", "chat", "slack"}


async def record_token_usage(
    session: AsyncSession,
    *,
    tenant_id: int | None,
    source: str,
    model: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
) -> None:
    """Append one usage row. No-op when the provider reported no usage (so we
    never log phantom zero rows). Added to the caller's session — the caller
    commits."""
    i = int(input_tokens or 0)
    o = int(output_tokens or 0)
    if i == 0 and o == 0:
        return
    session.add(
        TokenUsage(
            tenant_id=tenant_id,
            source=source if source in VALID_SOURCES else "agent",
            model=model,
            input_tokens=i,
            output_tokens=o,
        )
    )


async def get_sync_setting(session: AsyncSession) -> SyncSetting:
    """The single global sync-settings row (id=1). Created if missing so the
    app never crashes on a fresh DB; defaults to manual."""
    row = (
        await session.execute(select(SyncSetting).where(SyncSetting.id == 1))
    ).scalar_one_or_none()
    if row is None:
        row = SyncSetting(id=1, mode="manual", interval_minutes=30)
        session.add(row)
        await session.flush()
    return row
