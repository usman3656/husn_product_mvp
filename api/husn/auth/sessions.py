"""Redis-backed server-side sessions.

Opaque random session id in an HttpOnly cookie; payload lives in Redis so
revocation is a DEL. A secondary index set `user_sessions:{user_id}` lets an
admin removal kill every live session of that user immediately (belt) — and
the per-request membership re-validation in deps.py is the suspenders.

Session payload: {"user_id": int, "email": str, "active_tenant_id": int|None}
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from redis.asyncio import Redis, from_url

from husn.core.config import get_settings

COOKIE_NAME = "husn_session"

_SESSION_PREFIX = "session:"
_USER_SESSIONS_PREFIX = "user_sessions:"

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = from_url(get_settings().redis_url, decode_responses=True)
    return _redis


def _ttl_seconds() -> int:
    return get_settings().session_ttl_days * 86400


async def create_session(user_id: int, email: str, active_tenant_id: int | None = None) -> str:
    sid = secrets.token_urlsafe(32)
    payload = json.dumps(
        {"user_id": user_id, "email": email, "active_tenant_id": active_tenant_id}
    )
    r = get_redis()
    ttl = _ttl_seconds()
    await r.set(f"{_SESSION_PREFIX}{sid}", payload, ex=ttl)
    await r.sadd(f"{_USER_SESSIONS_PREFIX}{user_id}", sid)
    await r.expire(f"{_USER_SESSIONS_PREFIX}{user_id}", ttl)
    return sid


async def read_session(sid: str) -> dict[str, Any] | None:
    """Read + sliding-refresh the TTL."""
    r = get_redis()
    key = f"{_SESSION_PREFIX}{sid}"
    raw = await r.get(key)
    if raw is None:
        return None
    await r.expire(key, _ttl_seconds())
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


async def update_session(sid: str, **fields: Any) -> dict[str, Any] | None:
    data = await read_session(sid)
    if data is None:
        return None
    data.update(fields)
    r = get_redis()
    await r.set(f"{_SESSION_PREFIX}{sid}", json.dumps(data), ex=_ttl_seconds())
    return data


async def destroy_session(sid: str) -> None:
    r = get_redis()
    data = await read_session(sid)
    await r.delete(f"{_SESSION_PREFIX}{sid}")
    if data and data.get("user_id") is not None:
        await r.srem(f"{_USER_SESSIONS_PREFIX}{data['user_id']}", sid)


async def destroy_all_for_user(user_id: int) -> int:
    """Kill every live session of a user (admin removed them). Returns count."""
    r = get_redis()
    key = f"{_USER_SESSIONS_PREFIX}{user_id}"
    sids = await r.smembers(key)
    if sids:
        pipe = r.pipeline()
        for sid in sids:
            pipe.delete(f"{_SESSION_PREFIX}{sid}")
        pipe.delete(key)
        await pipe.execute()
    return len(sids or [])
