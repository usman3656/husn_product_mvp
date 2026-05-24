"""Microsoft Graph HTTP client with token-refresh-on-401.

Used for Outlook + OneDrive + Drive + SharePoint calls. Single OAuth token
covers all surfaces; Graph routes by URL path.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.microsoft.oauth import (
    MS_GRAPH_BASE,
    expires_at_from,
    refresh_access_token,
)
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Connection


class MicrosoftClient:
    def __init__(self, *, connection: Connection, session: AsyncSession) -> None:
        self.connection = connection
        self.session = session
        self._client = httpx.AsyncClient(timeout=30.0)

    async def __aenter__(self) -> "MicrosoftClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def _refresh_if_needed(self) -> None:
        exp = self.connection.token_expires_at
        if exp is None:
            return
        # Refresh 60s before expiry
        if (exp - datetime.now(UTC)).total_seconds() > 60:
            return
        await self._refresh()

    async def _refresh(self) -> None:
        s = get_settings()
        if not self.connection.refresh_token:
            raise RuntimeError("no refresh_token on microsoft connection")
        log.info("husn.microsoft.token.refresh", account_id=self.connection.account_id)
        tok = await refresh_access_token(
            tenant=s.ms_tenant,
            refresh_token=self.connection.refresh_token,
            client_id=s.ms_client_id,
            client_secret=s.ms_client_secret,
        )
        self.connection.access_token = tok["access_token"]
        # Microsoft rotates refresh tokens; persist the new one if returned.
        if tok.get("refresh_token"):
            self.connection.refresh_token = tok["refresh_token"]
        self.connection.token_expires_at = expires_at_from(tok.get("expires_in"))
        await self.session.commit()

    def _absolute(self, url: str) -> str:
        # Accepts both "/me/messages" relative and full https://graph...
        if url.startswith("http"):
            return url
        if url.startswith("/"):
            return f"{MS_GRAPH_BASE}{url}"
        return f"{MS_GRAPH_BASE}/{url}"

    async def request(
        self,
        method: str,
        url: str,
        *,
        params: dict | None = None,
        json: dict | None = None,
    ) -> httpx.Response:
        await self._refresh_if_needed()
        full = self._absolute(url)
        for attempt in range(3):
            r = await self._client.request(
                method,
                full,
                params=params,
                json=json,
                headers={
                    "Authorization": f"Bearer {self.connection.access_token}",
                    "Accept": "application/json",
                },
            )
            if r.status_code == 401 and attempt == 0:
                await self._refresh()
                continue
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After", "1"))
                log.warning("husn.microsoft.rate_limited", url=url, wait_s=wait)
                await asyncio.sleep(min(wait, 60))
                continue
            return r
        return r

    async def get(self, url: str, *, params: dict | None = None) -> dict[str, Any]:
        r = await self.request("GET", url, params=params)
        r.raise_for_status()
        return r.json()
