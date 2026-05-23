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


def make_state(*, source: str) -> str:
    payload = {"ts": int(time.time()), "nonce": secrets.token_urlsafe(16), "source": source}
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(_key(), body, hashlib.sha256).digest()
    return f"{_b64url(body)}.{_b64url(sig)}"


def verify_state(state: str, *, expected_source: str) -> bool:
    try:
        body_b64, sig_b64 = state.split(".", 1)
        body = _b64url_decode(body_b64)
        sig = _b64url_decode(sig_b64)
    except (ValueError, base64.binascii.Error):
        return False

    expected_sig = hmac.new(_key(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected_sig):
        return False

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return False

    if payload.get("source") != expected_source:
        return False
    if int(time.time()) - int(payload.get("ts", 0)) > MAX_STATE_AGE_SECONDS:
        return False

    return True
