"""Generic outbound email via Resend (for bot-sent emails).

Separate from husn.auth.emails (magic links). Blank RESEND_API_KEY (dev) logs
instead of sending so the flow is testable without email infra.
"""

from __future__ import annotations

from html import escape

import httpx

from husn.core.config import get_settings
from husn.core.logging import log

_RESEND_URL = "https://api.resend.com/emails"


def _text_to_html(body: str) -> str:
    safe = escape(body).replace("\n", "<br>")
    return (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
        'max-width:560px;margin:0 auto;padding:24px 16px;font-size:14px;'
        f'color:#27272a;line-height:1.6;">{safe}</div>'
    )


async def send_email(*, to: list[str], subject: str, body: str) -> bool:
    """Send a plain-text-ish email to one or more recipients. Returns True on
    success (or in dev mode). Never raises."""
    if not to:
        return False
    s = get_settings()
    if not s.resend_api_key:
        log.info("husn.email.dev_mode", to=to, subject=subject)
        return True
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {s.resend_api_key}"},
                json={
                    "from": s.resend_from,
                    "to": to,
                    "subject": subject or "(no subject)",
                    "html": _text_to_html(body),
                },
            )
            r.raise_for_status()
        log.info("husn.email.sent", to=to, subject=subject)
        return True
    except httpx.HTTPError as e:
        log.error("husn.email.send_failed", to=to, error=str(e)[:200])
        return False
