"""Slack OAuth v2 flow.

Reference: https://api.slack.com/authentication/oauth-v2

Endpoints:
  authorize -> https://slack.com/oauth/v2/authorize
  token     -> https://slack.com/api/oauth.v2.access
"""

from typing import Any
from urllib.parse import urlencode

import httpx

SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"
SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access"

# Bot Token Scopes. Read scopes power ingestion; the rest power the
# interactive bot (receive @mentions + DMs, reply, and DM the link). These must
# also be configured on the Slack app, or the authorize request is rejected.
SLACK_BOT_SCOPES = [
    # Ingestion (read)
    "channels:read",
    "channels:history",
    "users:read",
    "team:read",
    # Interactive bot
    "app_mentions:read",
    "chat:write",
    "im:read",
    "im:history",
    "im:write",
]


def build_authorize_url(*, client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "scope": ",".join(SLACK_BOT_SCOPES),
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{SLACK_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(
    *, code: str, client_id: str, client_secret: str, redirect_uri: str
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            SLACK_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        r.raise_for_status()
        body = r.json()
        if not body.get("ok"):
            raise RuntimeError(f"slack oauth.v2.access failed: {body.get('error')}")
        return body
