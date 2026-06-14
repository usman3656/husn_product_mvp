"""Username + password credential helpers.

Hashing: bcrypt. To sidestep bcrypt's silent 72-byte truncation (anything past
72 bytes is ignored, so a long password would be weaker than it looks), we
pre-hash the password with SHA-256 and base64-encode it before bcrypt. This is
a well-known, safe construction: bcrypt always sees a fixed 44-byte, null-free
input regardless of how long the user's password is.

Usernames are normalized to lowercase and validated to a conservative charset.
They are unique and IMMUTABLE once set (enforced at the endpoint layer); the
email magic link remains the recovery path.

Nothing here ever logs the raw password or the hash.
"""

from __future__ import annotations

import base64
import hashlib
import re

import bcrypt

from husn.auth.sessions import get_redis

# --- username rules -------------------------------------------------------

USERNAME_MIN = 3
USERNAME_MAX = 32
# Lowercase letters/digits with single internal . _ - separators; must start
# and end with an alphanumeric. Keeps usernames URL/display safe and avoids
# look-alike/whitespace tricks.
_USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$")

# --- password rules -------------------------------------------------------

PASSWORD_MIN = 8
PASSWORD_MAX = 128  # sanity bound; the pre-hash removes bcrypt's 72-byte limit


class CredentialError(ValueError):
    """Validation failure with a user-safe message (safe to return verbatim)."""


def normalize_username(raw: str) -> str:
    return raw.strip().lower()


def validate_username(raw: str) -> str:
    """Return the normalized username or raise CredentialError."""
    u = normalize_username(raw)
    if not (USERNAME_MIN <= len(u) <= USERNAME_MAX):
        raise CredentialError(
            f"Username must be {USERNAME_MIN}-{USERNAME_MAX} characters."
        )
    if not _USERNAME_RE.match(u):
        raise CredentialError(
            "Username may use lowercase letters, numbers, and . _ - "
            "(not at the start or end)."
        )
    return u


def validate_password(raw: str) -> str:
    """Return the password unchanged or raise CredentialError."""
    if not (PASSWORD_MIN <= len(raw) <= PASSWORD_MAX):
        raise CredentialError(
            f"Password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters."
        )
    return raw


# --- hashing --------------------------------------------------------------


def _prehash(raw: str) -> bytes:
    """SHA-256 → base64 so bcrypt sees a fixed-length, null-free input."""
    return base64.b64encode(hashlib.sha256(raw.encode("utf-8")).digest())


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_prehash(raw), bcrypt.gensalt()).decode("ascii")


def verify_password(raw: str, hashed: str | None) -> bool:
    """Constant-time-ish verify. Returns False (never raises) on any malformed
    or missing hash so callers can treat it as a plain auth failure."""
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(_prehash(raw), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


# A precomputed hash of a random string, used to spend the same CPU on a
# missing-user login attempt as on a real one — equalizes timing so an
# attacker can't distinguish "no such username" from "wrong password".
_DUMMY_HASH = hash_password("husn-timing-equalizer-not-a-real-password")


def dummy_verify() -> None:
    """Burn one bcrypt verification to keep failed-lookup timing constant."""
    verify_password("x", _DUMMY_HASH)


# --- login-attempt rate limiting -----------------------------------------

LOGIN_ATTEMPT_MAX = 10
LOGIN_ATTEMPT_WINDOW_S = 900  # 15 min


async def login_attempt_ok(username: str) -> bool:
    """True while under the per-username attempt budget. Counts every attempt;
    a sliding 15-min window of 10 throttles online password guessing without a
    lockout an attacker could weaponize to deny a real user."""
    r = get_redis()
    key = f"pwlogin_rl:{normalize_username(username)}"
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, LOGIN_ATTEMPT_WINDOW_S)
    return n <= LOGIN_ATTEMPT_MAX


async def reset_login_attempts(username: str) -> None:
    """Clear the counter after a successful login."""
    await get_redis().delete(f"pwlogin_rl:{normalize_username(username)}")
