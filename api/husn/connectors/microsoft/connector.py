from collections.abc import AsyncIterator
from typing import Any

from husn.connectors.base import Connector, FetchedArtifact


class MicrosoftConnector(Connector):
    source = "microsoft"

    async def backfill(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        if False:  # pragma: no cover
            yield FetchedArtifact(kind="email", external_id="", payload={})
        return

    async def poll_delta(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        if False:  # pragma: no cover
            yield FetchedArtifact(kind="email", external_id="", payload={})
        return
