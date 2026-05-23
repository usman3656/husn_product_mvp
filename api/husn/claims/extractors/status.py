"""Status extractors.

Jira → structured `fields.status.name` (high confidence).
Slack → regex match on "blocked", "at risk", "on track", "unblocked" (lower confidence).
"""

import re
from typing import Any, ClassVar

from husn.claims.base import ClaimCandidate

# Phrases that map to a normalized status. Order matters (first match wins).
SLACK_STATUS_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bat risk\b", re.IGNORECASE), "at-risk"),
    (re.compile(r"\bon track\b", re.IGNORECASE), "on-track"),
    (re.compile(r"\bunblocked\b", re.IGNORECASE), "unblocked"),
    (re.compile(r"\bblocked\b", re.IGNORECASE), "blocked"),
    (re.compile(r"\bbehind schedule\b", re.IGNORECASE), "at-risk"),
    (re.compile(r"\bahead of schedule\b", re.IGNORECASE), "on-track"),
    (re.compile(r"\bdelayed\b", re.IGNORECASE), "at-risk"),
]


class JiraStatusExtractor:
    id: ClassVar[str] = "jira.status"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("jira", "issue")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        fields = raw_payload.get("fields") or {}
        status = fields.get("status") or {}
        name = status.get("name")
        if not name:
            return []
        return [
            ClaimCandidate(
                kind="status",
                key="issue_status",
                value=name,
                value_norm=name.lower().replace(" ", "-"),
                confidence=1.0,
                source_anchor={
                    "kind": "field",
                    "artifact_id": artifact_row.id,
                    "field_path": "fields.status.name",
                },
            )
        ]


class SlackStatusExtractor:
    id: ClassVar[str] = "slack.status.regex"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("slack", "message")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        text = raw_payload.get("text") or ""
        if not text:
            return []
        out: list[ClaimCandidate] = []
        for pattern, normalized in SLACK_STATUS_PATTERNS:
            for m in pattern.finditer(text):
                snippet = text[max(0, m.start() - 40) : m.end() + 40]
                out.append(
                    ClaimCandidate(
                        kind="status",
                        key=normalized,
                        value=m.group(0),
                        value_norm=normalized,
                        confidence=0.6,
                        source_anchor={
                            "kind": "span",
                            "artifact_id": artifact_row.id,
                            "char_start": m.start(),
                            "char_end": m.end(),
                            "snippet": snippet,
                        },
                    )
                )
            # one match of each kind is enough — avoid duplicates if same word repeats
            if out and out[-1].value_norm == normalized:
                break
        return out
