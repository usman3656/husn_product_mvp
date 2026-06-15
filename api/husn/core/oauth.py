"""OAuth helpers — signed state nonces, no DB required.

The state value sent through an OAuth authorize redirect must be opaque to the
provider but verifiable on callback. We sign a JSON payload {ts, nonce, source}
with HMAC-SHA256 keyed on settings.session_secret; the callback recomputes the
signature and rejects mismatches or stale states (>10 min).
"""

import base64
import hashlib
import hmac
import json
import secrets
import time

from husn.core.config import get_settings

MAX_STATE_AGE_SECONDS = 600


def _key() -> bytes:
    return get_settings().session_secret.encode("utf-8")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def make_state(
    *, source: str, tenant_id: int | None = None, user_id: int | None = None
) -> str:
    """tenant_id/user_id ride the signed state through the provider dance so
    the callback can stamp the Connection row with its owner workspace
    (TENANCY.md §5).

    HARD-GATED on AUTH_REQUIRED: during the bridge a logged-in founder
    reconnecting a tool must NOT stamp a tenant — mixed NULL/real tenant
    rows would collide with the still-global unique constraints (projects
    slug, person identities, claim groups) that are only re-keyed per-tenant
    in migration 0010 at the C4 cutover.
    """
    payload: dict = {"ts": int(time.time()), "nonce": secrets.token_urlsafe(16), "source": source}
    if get_settings().auth_required:
        if tenant_id is not None:
            payload["tid"] = tenant_id
        if user_id is not None:
            payload["uid"] = user_id
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(_key(), body, hashlib.sha256).digest()
    return f"{_b64url(body)}.{_b64url(sig)}"


def sign_token(payload: dict, *, source: str) -> str:
    """Generic signed, self-describing token (HMAC-SHA256 over the JSON body).
    Carries arbitrary fields plus a timestamp and `source` tag. Used for the
    Slack account-link links the bot DMs out."""
    body = json.dumps(
        {**payload, "source": source, "ts": int(time.time())}, separators=(",", ":")
    ).encode("utf-8")
    sig = hmac.new(_key(), body, hashlib.sha256).digest()
    return f"{_b64url(body)}.{_b64url(sig)}"


def read_token(token: str, *, expected_source: str, max_age_s: int) -> dict | None:
    """Verify signature, source, and freshness; return the payload or None."""
    try:
        body_b64, sig_b64 = token.split(".", 1)
        body = _b64url_decode(body_b64)
        sig = _b64url_decode(sig_b64)
    except (ValueError, base64.binascii.Error):
        return None
    if not hmac.compare_digest(sig, hmac.new(_key(), body, hashlib.sha256).digest()):
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    if payload.get("source") != expected_source:
        return None
    if int(time.time()) - int(payload.get("ts", 0)) > max_age_s:
        return None
    return payload


def verify_state(state: str, *, expected_source: str) -> bool:
    return parse_state(state, expected_source=expected_source) is not None


def parse_state(state: str, *, expected_source: str) -> dict | None:
    """Verify + decode. Returns the payload dict (may carry tid/uid) or None."""
    try:
        body_b64, sig_b64 = state.split(".", 1)
        body = _b64url_decode(body_b64)
        sig = _b64url_decode(sig_b64)
    except (ValueError, base64.binascii.Error):
        return None

    expected_sig = hmac.new(_key(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected_sig):
        return None

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None

    if payload.get("source") != expected_source:
        return None
    if int(time.time()) - int(payload.get("ts", 0)) > MAX_STATE_AGE_SECONDS:
        return None

    return payload
