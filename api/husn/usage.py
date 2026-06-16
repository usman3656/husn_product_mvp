"""Token-usage ledger + sync-setting helpers + live provider rate-limit snapshot."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.sessions import get_redis
from husn.db.models import SyncSetting, TokenUsage

VALID_SOURCES = {"agent", "chat", "slack"}

# --- live provider rate-limit snapshot (the REAL quota state, from the LLM
# provider's response headers — distinct from our own token ledger) ----------

_LIMITS_PREFIX = "provider_limits:"
_RATELIMIT_HEADER_KEYS = (
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
    "retry-after",
)


async def record_provider_limits(provider: str, headers: Any, status_code: int) -> None:
    """Persist the latest rate-limit headers from a provider response to Redis,
    so the UI can show live remaining quota. Best-effort — never raises (telemetry
    must not break an LLM call)."""
    try:
        snap: dict[str, Any] = {
            k: headers.get(k) for k in _RATELIMIT_HEADER_KEYS if headers.get(k) is not None
        }
        if not snap:
            return
        snap["provider"] = provider
        snap["status_code"] = status_code
        snap["rate_limited"] = status_code == 429
        snap["updated_at"] = datetime.now(UTC).isoformat()
        await get_redis().set(_LIMITS_PREFIX + provider, json.dumps(snap), ex=86400)
    except Exception:
        pass


async def get_provider_limits(provider: str) -> dict[str, Any] | None:
    try:
        raw = await get_redis().get(_LIMITS_PREFIX + provider)
        return json.loads(raw) if raw else None
    except Exception:
        return None


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
