"""Magic-link tokens.

We store ONLY the SHA-256 of the token, so a DB leak cannot forge logins.
Single-use is enforced atomically via UPDATE ... WHERE used_at IS NULL
RETURNING — race-proof under concurrent clicks (email scanners).
Rate limiting: 3 sends per email per 15 min via a Redis counter.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.sessions import get_redis
from husn.db.models import LoginToken

TOKEN_TTL_MINUTES = 15
RATE_LIMIT_MAX = 3
RATE_LIMIT_WINDOW_S = 900


def normalize_email(email: str) -> str:
    """Lowercase + trim. NO gmail dot/plus canonicalization — a+x@ is a
    distinct identity (Atlassian/Slack semantics; canonicalizing mis-links
    people)."""
    return email.strip().lower()


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def rate_limit_ok(email: str) -> bool:
    r = get_redis()
    key = f"login_rl:{normalize_email(email)}"
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, RATE_LIMIT_WINDOW_S)
    return n <= RATE_LIMIT_MAX


async def create_login_token(session: AsyncSession, email: str) -> str:
    """Insert a token row and return the RAW token (only ever exists in the
    email link; we keep the hash)."""
    raw = secrets.token_urlsafe(32)
    session.add(
        LoginToken(
            email=normalize_email(email),
            token_hash=hash_token(raw),
            expires_at=datetime.now(UTC) + timedelta(minutes=TOKEN_TTL_MINUTES),
        )
    )
    await session.commit()
    return raw


async def consume_login_token(session: AsyncSession, raw: str) -> str | None:
    """Atomically mark the token used. Returns the email on success, None on
    invalid/expired/already-used."""
    row = (
        await session.execute(
            text(
                """
                UPDATE login_tokens
                   SET used_at = now()
                 WHERE token_hash = :h
                   AND used_at IS NULL
                   AND expires_at > now()
                RETURNING email
                """
            ),
            {"h": hash_token(raw)},
        )
    ).first()
    await session.commit()
    return row.email if row else None
