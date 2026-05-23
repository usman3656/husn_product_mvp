"""Owner/author extractors. High confidence — structured fields only."""

from typing import Any, ClassVar

from husn.claims.base import ClaimCandidate


class JiraOwnerExtractor:
    id: ClassVar[str] = "jira.owner"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("jira", "issue")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        fields = raw_payload.get("fields") or {}
        out: list[ClaimCandidate] = []

        assignee = fields.get("assignee")
        if isinstance(assignee, dict) and assignee.get("accountId"):
            out.append(
                ClaimCandidate(
                    kind="owner",
                    key="assignee",
                    value=assignee.get("displayName") or assignee["accountId"],
                    value_norm=f"jira:user:{assignee['accountId']}",
                    confidence=1.0,
                    source_anchor={
                        "kind": "field",
                        "artifact_id": artifact_row.id,
                        "field_path": "fields.assignee",
                    },
                )
            )

        creator = fields.get("creator") or fields.get("reporter")
        if isinstance(creator, dict) and creator.get("accountId"):
            out.append(
                ClaimCandidate(
                    kind="owner",
                    key="reporter",
                    value=creator.get("displayName") or creator["accountId"],
                    value_norm=f"jira:user:{creator['accountId']}",
                    confidence=1.0,
                    source_anchor={
                        "kind": "field",
                        "artifact_id": artifact_row.id,
                        "field_path": "fields.creator",
                    },
                )
            )

        return out


class SlackAuthorExtractor:
    id: ClassVar[str] = "slack.author"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("slack", "message")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        user = raw_payload.get("user") or raw_payload.get("bot_id")
        if not user:
            return []
        return [
            ClaimCandidate(
                kind="owner",
                key="author",
                value=user,
                value_norm=f"slack:user:{user}",
                confidence=1.0,
                source_anchor={
                    "kind": "field",
                    "artifact_id": artifact_row.id,
                    "field_path": "user",
                },
            )
        ]
