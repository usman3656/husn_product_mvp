from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class FetchedArtifact:
    """Source-shaped record produced by a connector. The normalizer in Step 2
    is responsible for mapping these into the operational graph; for now we
    persist them verbatim via husn.db.upsert.upsert_raw_artifact.
    """

    kind: str
    external_id: str
    payload: dict[str, Any]
    version: str = "1"


class Connector(ABC):
    """
    Per-source connector interface. Each implementation owns OAuth, throttling,
    and incremental sync against one external system.

    Slack/Atlassian/Google/Microsoft ToS notes drive the shape of this interface
    (see knowledge.md sec. 6):
      - Customer-installed app per workspace where possible (Slack ToS, May 2025)
      - OAuth-only for email (no shadow inbox)
      - Channel/folder allowlists (data minimization for GDPR)
    """

    source: str  # short slug, matches RawArtifact.source

    @abstractmethod
    async def backfill(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        """Yield historical artifacts within the configured project scope."""
        raise NotImplementedError

    @abstractmethod
    async def poll_delta(self, *, project_scope: dict[str, Any]) -> AsyncIterator[FetchedArtifact]:
        """Yield artifacts changed since the last successful run."""
        raise NotImplementedError
