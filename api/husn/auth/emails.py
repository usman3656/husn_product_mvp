"""Outbound auth email via Resend.

Blank RESEND_API_KEY (local dev) → the link is logged to stdout instead of
sent, so the flow is testable without email infra.
"""

from __future__ import annotations

import httpx

from husn.core.config import get_settings
from husn.core.logging import log

_RESEND_URL = "https://api.resend.com/emails"


async def send_magic_link(email: str, link: str) -> bool:
    s = get_settings()
    if not s.resend_api_key:
        log.info("husn.auth.magic_link.dev_mode", email=email, link=link)
        return True

    html = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px;">
      <p style="font-size:15px;color:#3f3f46;">Sign in to Husn</p>
      <p style="font-size:14px;color:#6b6b71;line-height:1.6;">
        Click the button below to sign in. This link is valid for 15 minutes
        and can be used once. If you didn't request it, ignore this email.
      </p>
      <p style="margin:28px 0;">
        <a href="{link}"
           style="background:#18181b;color:#ffffff;text-decoration:none;border-radius:999px;padding:10px 22px;font-size:14px;font-weight:600;">
          Sign in to Husn
        </a>
      </p>
      <p style="font-size:12px;color:#a1a1aa;">husn — the intelligence layer for your organization.</p>
    </div>
    """

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {s.resend_api_key}"},
                json={
                    "from": s.resend_from,
                    "to": [email],
                    "subject": "Sign in to Husn",
                    "html": html,
                },
            )
            r.raise_for_status()
        log.info("husn.auth.magic_link.sent", email=email)
        return True
    except httpx.HTTPError as e:
        log.error("husn.auth.magic_link.send_failed", email=email, error=str(e))
        return False
