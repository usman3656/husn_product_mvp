"""Jira REST client with token-refresh-on-401.

Per knowledge.md §7 row 2 — Jira Cloud will enforce points-based rate limits
from Mar 2, 2026 (65k/hr per site). We honour 429 Retry-After and back off.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.jira.oauth import expires_at_from, refresh_access_token
from husn.core.config import get_settings
from husn.core.logging import log
from husn.db.models import Connection

JIRA_API_BASE = "https://api.atlassian.com/ex/jira"


class JiraClient:
    def __init__(self, *, connection: Connection, session: AsyncSession) -> None:
        self.connection = connection
        self.session = session
        self.cloud_id = connection.account_id
        self._client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "JiraClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

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
            raise RuntimeError("no refresh_token on connection")
        log.info("husn.jira.token.refresh", account_id=self.connection.account_id)
        token = await refresh_access_token(
            refresh_token=self.connection.refresh_token,
            client_id=s.jira_client_id,
            client_secret=s.jira_client_secret,
        )
        self.connection.access_token = token["access_token"]
        # Atlassian rotates refresh tokens; persist the new one if returned.
        if token.get("refresh_token"):
            self.connection.refresh_token = token["refresh_token"]
        self.connection.token_expires_at = expires_at_from(token.get("expires_in"))
        await self.session.commit()

    async def request(
        self, method: str, path: str, *, params: dict | None = None, json: dict | None = None
    ) -> httpx.Response:
        await self._refresh_if_needed()
        url = f"{JIRA_API_BASE}/{self.cloud_id}{path}"
        for attempt in range(3):
            r = await self._client.request(
                method,
                url,
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
                log.warning("husn.jira.rate_limited", wait_s=wait)
                await asyncio.sleep(min(wait, 30))
                continue
            return r
        return r  # last response (caller decides)

    async def get(self, path: str, *, params: dict | None = None) -> dict[str, Any]:
        r = await self.request("GET", path, params=params)
        r.raise_for_status()
        return r.json()

    async def list_projects(self) -> list[dict[str, Any]]:
        # GET /rest/api/3/project — returns ALL accessible projects
        return await self.get("/rest/api/3/project")  # type: ignore[return-value]

    async def search_issues_page(
        self, *, jql: str, next_page_token: str | None = None, fields: str = "*all"
    ) -> dict[str, Any]:
        # GET /rest/api/3/search/jql — the new (non-deprecated) endpoint, uses
        # nextPageToken cursor pagination. The legacy /search endpoint is being
        # sunset; /search/jql became required in 2024.
        params: dict[str, Any] = {"jql": jql, "fields": fields, "maxResults": 100}
        if next_page_token:
            params["nextPageToken"] = next_page_token
        return await self.get("/rest/api/3/search/jql", params=params)
