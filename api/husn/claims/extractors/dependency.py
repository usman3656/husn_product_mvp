"""Dependency extractors.

Slack → regex over message text. Jira → structured `fields.issuelinks` (high
confidence). Both normalize to `dep:src->dst` or `blocks:src->dst` so a
ClaimGroup can collect every mention of the same edge.
"""

import re
from typing import Any, ClassVar

from husn.claims.base import ClaimCandidate

# (pattern, kind_prefix, swap). When swap=True the regex captures (b, a)
# in source order but the edge is still a->b in the normalized form
# ("waiting on B before A" -> A depends on B).
_DEP_PATTERNS: list[tuple[re.Pattern[str], str, bool]] = [
    (re.compile(r"\b(?P<a>[\w/-]+)\s+depends\s+on\s+(?P<b>[\w/-]+)", re.IGNORECASE), "dep", False),
    (re.compile(r"\b(?P<a>[\w/-]+)\s+(?:blocks|is\s+blocking)\s+(?P<b>[\w/-]+)", re.IGNORECASE), "blocks", False),
    (re.compile(r"\b(?P<a>[\w/-]+)\s+is\s+a\s+prereq(?:uisite)?\s+for\s+(?P<b>[\w/-]+)", re.IGNORECASE), "blocks", False),
    (re.compile(r"\bwaiting\s+on\s+(?P<b>[\w/-]+)\s+(?:before|to)\s+(?P<a>[\w/-]+)", re.IGNORECASE), "dep", True),
]


class SlackDependencyExtractor:
    id: ClassVar[str] = "slack.dependency.regex"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("slack", "message")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        text = raw_payload.get("text") or ""
        if not text:
            return []

        out: list[ClaimCandidate] = []
        for pattern, prefix, _swap in _DEP_PATTERNS:
            for m in pattern.finditer(text):
                a = m.group("a").strip()
                b = m.group("b").strip()
                if not a or not b or a.lower() == b.lower():
                    continue
                snippet_start = max(0, m.start() - 30)
                snippet_end = min(len(text), m.end() + 30)
                if prefix == "blocks":
                    value = f"{a} blocks {b}"
                    value_norm = f"blocks:{a.lower()}->{b.lower()}"
                else:
                    value = f"{a}->{b}"
                    value_norm = f"dep:{a.lower()}->{b.lower()}"
                out.append(
                    ClaimCandidate(
                        kind="dependency",
                        key="dependency",
                        value=value,
                        value_norm=value_norm,
                        confidence=0.6,
                        source_anchor={
                            "kind": "span",
                            "artifact_id": artifact_row.id,
                            "char_start": m.start(),
                            "char_end": m.end(),
                            "snippet": text[snippet_start:snippet_end],
                            "pattern": prefix,
                        },
                    )
                )
        return out


class JiraDependencyExtractor:
    """Jira: walk fields.issuelinks for blocks / is blocked by edges."""

    id: ClassVar[str] = "jira.dependency"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("jira", "issue")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        fields = raw_payload.get("fields") or {}
        links = fields.get("issuelinks") or []
        if not isinstance(links, list):
            return []

        this_key = raw_payload.get("key") or ""
        out: list[ClaimCandidate] = []
        for idx, link in enumerate(links):
            if not isinstance(link, dict):
                continue
            link_type = (link.get("type") or {}).get("name", "").lower()
            if link_type != "blocks":
                continue
            outward = link.get("outwardIssue")  # this issue blocks outward
            inward = link.get("inwardIssue")    # this issue is blocked by inward
            if isinstance(outward, dict) and outward.get("key"):
                src, dst = this_key, outward["key"]
            elif isinstance(inward, dict) and inward.get("key"):
                src, dst = inward["key"], this_key
            else:
                continue
            if not src or not dst:
                continue
            out.append(
                ClaimCandidate(
                    kind="dependency",
                    key="dependency",
                    value=f"{src} blocks {dst}",
                    value_norm=f"blocks:{src}->{dst}",
                    confidence=1.0,
                    source_anchor={
                        "kind": "field",
                        "artifact_id": artifact_row.id,
                        "field_path": f"fields.issuelinks[{idx}]",
                    },
                )
            )
        return out
