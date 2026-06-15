"""Slack Web API client.

Honours 429 Retry-After. Bot tokens don't expire (no refresh logic needed).
Per knowledge.md §6A: persistent storage of API data is prohibited for
non-Marketplace third-party apps. For local MVP / custom-workspace install,
the workspace-owns-the-app pattern is the ToS-compliant route.
"""

import asyncio
from typing import Any

import httpx

from husn.core.logging import log
from husn.db.models import Connection

SLACK_API_BASE = "https://slack.com/api"


class SlackClient:
    def __init__(self, *, connection: Connection) -> None:
        self.connection = connection
        self.token = connection.access_token
        self._client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "SlackClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def _call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{SLACK_API_BASE}/{method}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        for attempt in range(4):
            r = await self._client.get(url, params=params, headers=headers)
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After", "1"))
                log.warning("husn.slack.rate_limited", method=method, wait_s=wait)
                await asyncio.sleep(min(wait, 60))
                continue
            r.raise_for_status()
            body = r.json()
            if not body.get("ok"):
                # Slack returns 200 with ok:false for app-level errors
                # (rate_limited, missing_scope, channel_not_found, etc.)
                err = body.get("error", "unknown")
                if err == "ratelimited" and attempt < 3:
                    await asyncio.sleep(1.5)
                    continue
                raise RuntimeError(f"slack {method} failed: {err}")
            return body
        raise RuntimeError(f"slack {method} exhausted retries")

    async def conversations_list(
        self,
        *,
        types: str = "public_channel",
        limit: int = 200,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"types": types, "limit": limit, "exclude_archived": True}
        if cursor:
            params["cursor"] = cursor
        return await self._call("conversations.list", params)

    async def conversations_history(
        self, *, channel: str, limit: int = 100, cursor: str | None = None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"channel": channel, "limit": limit}
        if cursor:
            params["cursor"] = cursor
        return await self._call("conversations.history", params)

    async def users_list(self, *, cursor: str | None = None, limit: int = 200) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        return await self._call("users.list", params)

    async def open_im(self, *, user_id: str) -> str | None:
        """conversations.open — returns the DM channel id for a user. Requires
        `im:write`. Use this before DMing (more reliable than passing a user id
        straight to chat.postMessage)."""
        url = f"{SLACK_API_BASE}/conversations.open"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json; charset=utf-8",
        }
        r = await self._client.post(url, json={"users": user_id}, headers=headers)
        r.raise_for_status()
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"slack conversations.open failed: {data.get('error')}")
        return (data.get("channel") or {}).get("id")

    async def post_message(
        self, *, channel: str, text: str, thread_ts: str | None = None
    ) -> dict[str, Any]:
        """chat.postMessage — outbound reply. Requires the `chat:write` scope on
        the bot token (added for the interactive bot)."""
        url = f"{SLACK_API_BASE}/chat.postMessage"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json; charset=utf-8",
        }
        body: dict[str, Any] = {"channel": channel, "text": text}
        if thread_ts:
            body["thread_ts"] = thread_ts
        r = await self._client.post(url, json=body, headers=headers)
        r.raise_for_status()
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"slack chat.postMessage failed: {data.get('error')}")
        return data
