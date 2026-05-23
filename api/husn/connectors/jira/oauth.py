"""Atlassian OAuth 2.0 (3LO) flow.

Reference: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/

Endpoints:
  authorize  -> https://auth.atlassian.com/authorize
  token      -> https://auth.atlassian.com/oauth/token
  resources  -> https://api.atlassian.com/oauth/token/accessible-resources
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

JIRA_AUTHORIZE_URL = "https://auth.atlassian.com/authorize"
JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token"
JIRA_ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"

JIRA_SCOPES = [
    "read:jira-work",
    "read:jira-user",
    "manage:jira-webhook",
    "offline_access",
]


def build_authorize_url(*, client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "audience": "api.atlassian.com",
        "client_id": client_id,
        "scope": " ".join(JIRA_SCOPES),
        "redirect_uri": redirect_uri,
        "state": state,
        "response_type": "code",
        "prompt": "consent",
    }
    return f"{JIRA_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(
    *, code: str, client_id: str, client_secret: str, redirect_uri: str
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            JIRA_TOKEN_URL,
            json={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        r.raise_for_status()
        return r.json()


async def refresh_access_token(
    *, refresh_token: str, client_id: str, client_secret: str
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            JIRA_TOKEN_URL,
            json={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
            },
        )
        r.raise_for_status()
        return r.json()


async def list_accessible_resources(access_token: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            JIRA_ACCESSIBLE_RESOURCES_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        r.raise_for_status()
        return r.json()


def expires_at_from(expires_in: int | None) -> datetime | None:
    if expires_in is None:
        return None
    return datetime.now(UTC) + timedelta(seconds=int(expires_in))
