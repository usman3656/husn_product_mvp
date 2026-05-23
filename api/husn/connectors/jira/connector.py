from collections.abc import AsyncIterator
from typing import Any

from husn.connectors.base import Connector, FetchedArtifact


class JiraConnector(Connector):
    source = "jira"

    async def backfill(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        # Jira Cloud points-based rate limits land Mar 2, 2026 (65k/hr per site).
        # Backfill must paginate at a low priority to avoid 429s on large instances.
        if False:  # pragma: no cover
            yield FetchedArtifact(kind="issue", external_id="", payload={})
        return

    async def poll_delta(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        if False:  # pragma: no cover
            yield FetchedArtifact(kind="issue", external_id="", payload={})
        return
