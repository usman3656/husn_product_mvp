from collections.abc import AsyncIterator
from typing import Any

from husn.connectors.base import Connector, FetchedArtifact


class SlackConnector(Connector):
    source = "slack"

    async def backfill(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        # OAuth bot install + conversations.history on allowlisted channels.
        # Implementation lands when Slack workspace credentials are wired.
        if False:  # pragma: no cover
            yield FetchedArtifact(kind="message", external_id="", payload={})
        return

    async def poll_delta(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        # Backed by Events API webhooks; this poll is a reconciliation pass.
        if False:  # pragma: no cover
            yield FetchedArtifact(kind="message", external_id="", payload={})
        return
