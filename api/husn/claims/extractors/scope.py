"""Scope extractors.

Slack-message regex for scope changes ("descoping X", "X is out of scope",
"cutting X from the release", "X is back in"). Lower precision on purpose —
Step 4 weighs these against structured signals.

NOTE: decision.py already emits some scope-flavored candidates from broader
phrasings ("we're cutting X", "moving X to Y"). This extractor is tighter:
it captures a single object token and normalizes to descope:/include: so
ClaimGroup keying lines up across messages.
"""

import re
from typing import Any, ClassVar

from husn.claims.base import ClaimCandidate

# (pattern, normalization_prefix). Object token is `\w/-` only — keeps us
# from swallowing trailing prose ("descoping the login flow because ..." would
# only capture "the"; that's fine — we'd rather miss than overreach).
_SCOPE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bdescop(?:e|ing|ed)\s+(?P<obj>[\w/-]+)", re.IGNORECASE), "descope"),
    (re.compile(r"\bcutt?ing\s+(?P<obj>[\w/-]+)\s+(?:from|out\s+of)\b", re.IGNORECASE), "descope"),
    (re.compile(r"\b(?P<obj>[\w/-]+)\s+is\s+(?:out\s+of\s+scope|descoped|cut)\b", re.IGNORECASE), "descope"),
    (re.compile(r"\b(?P<obj>[\w/-]+)\s+is\s+(?:in\s+scope|back\s+in)\b", re.IGNORECASE), "include"),
]


def _extract_scope(text: str, *, artifact_id: int) -> list[ClaimCandidate]:
    out: list[ClaimCandidate] = []
    for pattern, prefix in _SCOPE_PATTERNS:
        for m in pattern.finditer(text):
            obj = m.group("obj").strip()
            if not obj:
                continue
            snippet_start = max(0, m.start() - 30)
            snippet_end = min(len(text), m.end() + 30)
            out.append(
                ClaimCandidate(
                    kind="scope",
                    key="scope",
                    value=obj,
                    value_norm=f"{prefix}:{obj.lower()}",
                    confidence=0.6,
                    source_anchor={
                        "kind": "span",
                        "artifact_id": artifact_id,
                        "char_start": m.start(),
                        "char_end": m.end(),
                        "snippet": text[snippet_start:snippet_end],
                        "pattern": prefix,
                    },
                )
            )
    return out


class SlackScopeExtractor:
    id: ClassVar[str] = "slack.scope.regex"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("slack", "message")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        text = raw_payload.get("text") or ""
        if not text:
            return []
        return _extract_scope(text, artifact_id=artifact_row.id)
