"""Microsoft Entra OAuth 2.0 (authorization code flow).

Reference: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow

Endpoints (tenant-specific or 'common' for personal + work):
  authorize -> https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
  token     -> https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
  me        -> https://graph.microsoft.com/v1.0/me
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Scopes we ask for. `offline_access` is mandatory for refresh tokens.
MS_SCOPES = [
    "openid",
    "profile",
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Files.Read",
    "Sites.Read.All",
]


def authorize_endpoint(tenant: str) -> str:
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"


def token_endpoint(tenant: str) -> str:
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def build_authorize_url(
    *, tenant: str, client_id: str, redirect_uri: str, state: str
) -> str:
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": " ".join(MS_SCOPES),
        "state": state,
        # `select_account` so a returning user can switch identities (good UX +
        # makes per-account isolation explicit).
        "prompt": "select_account",
    }
    return f"{authorize_endpoint(tenant)}?{urlencode(params)}"


async def exchange_code(
    *,
    tenant: str,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            token_endpoint(tenant),
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": " ".join(MS_SCOPES),
            },
        )
        r.raise_for_status()
        return r.json()


async def refresh_access_token(
    *,
    tenant: str,
    refresh_token: str,
    client_id: str,
    client_secret: str,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            token_endpoint(tenant),
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "scope": " ".join(MS_SCOPES),
            },
        )
        r.raise_for_status()
        return r.json()


async def get_me(access_token: str) -> dict[str, Any]:
    """Returns {id, userPrincipalName, mail, displayName, ...}."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{MS_GRAPH_BASE}/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r.raise_for_status()
        return r.json()


def expires_at_from(expires_in: int | None) -> datetime | None:
    if expires_in is None:
        return None
    return datetime.now(UTC) + timedelta(seconds=int(expires_in))
