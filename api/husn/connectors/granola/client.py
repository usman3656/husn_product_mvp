"""Granola public API client.

Base: https://public-api.granola.ai/v1 — bearer auth with the pasted API key
(`Authorization: Bearer grn_…`). Honours 429 Retry-After (the API allows
~5 req/s sustained). API keys don't expire, so there's no refresh logic.
"""

import asyncio
from typing import Any

import httpx

from husn.core.logging import log
from husn.db.models import Connection

GRANOLA_API_BASE = "https://public-api.granola.ai/v1"


class GranolaClient:
    def __init__(self, *, connection: Connection | None = None, api_key: str | None = None) -> None:
        # Either drive it off a stored Connection (backfill) or a raw key
        # (validating a key at connect time, before the Connection exists).
        self.token = api_key if api_key is not None else (connection.access_token if connection else None)
        if not self.token:
            raise ValueError("GranolaClient requires an api_key or a connection with access_token")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "GranolaClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{GRANOLA_API_BASE}{path}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        for attempt in range(4):
            r = await self._client.get(url, params=params, headers=headers)
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After", "1"))
                log.warning("husn.granola.rate_limited", path=path, wait_s=wait)
                await asyncio.sleep(min(wait, 60))
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError(f"granola GET {path} exhausted retries")

    async def list_notes(
        self, *, created_after: str | None = None, cursor: str | None = None
    ) -> dict[str, Any]:
        """One page of notes. Response: {notes: [...], hasMore: bool, cursor: str}."""
        params: dict[str, Any] = {}
        if created_after:
            params["created_after"] = created_after
        if cursor:
            params["cursor"] = cursor
        return await self._get("/notes", params or None)

    async def get_note(self, note_id: str, *, include_transcript: bool = False) -> dict[str, Any]:
        """Full note: {id, title, owner, summary, transcript?}."""
        params = {"include": "transcript"} if include_transcript else None
        return await self._get(f"/notes/{note_id}", params)
