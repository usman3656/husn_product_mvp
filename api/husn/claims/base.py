"""Extractor framework.

Each extractor is a small class with:
  - id: unique slug (e.g. "jira.duedate", "slack.decision.regex")
  - version: bump to force re-extraction on rule changes
  - kinds: set of artifact (source, kind) tuples it applies to
  - extract(artifact, raw_payload) -> list[ClaimCandidate]

Candidates are upserted by upsert_claim() keyed on
(source_artifact_id, kind, key, extractor_id, extractor_version) so re-runs
are idempotent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol


@dataclass(slots=True)
class ClaimCandidate:
    kind: str  # date | owner | status | scope | decision | dependency
    key: str  # e.g. "duedate", "launch", "assignee", "decision"
    value: str | None
    value_norm: str | None
    confidence: float
    source_anchor: dict[str, Any]
    extra: dict[str, Any] | None = field(default=None)


class Extractor(Protocol):
    id: ClassVar[str]
    version: ClassVar[int]
    kinds: ClassVar[set[tuple[str, str]]]  # {(source, artifact_kind), ...}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]: ...
