"""Decision + scope-change extractors.

Slack-message regex, low-precision on purpose. These are *candidate* claims
that Step 4 weighs alongside higher-confidence date/owner claims. Each match
captures the verbatim span so a human can verify.
"""

import re
from typing import Any, ClassVar

from husn.claims.base import ClaimCandidate

# Patterns that suggest a decision or scope change was recorded in a message.
# Captures (key, regex). Keep the regex tight — false positives in Step 4
# drift detection are expensive (one bad alert and the TPM mutes the channel).
_DECISION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("decision_marker", re.compile(r"\b(?:decision|decided)\s*:\s*([^\n]{4,200})", re.IGNORECASE)),
    ("agreement", re.compile(r"\b(?:we|the team)\s+(?:agreed|aligned)\s+(?:that\s+)?([^\n.!?]{4,200})", re.IGNORECASE)),
    ("scope_cut", re.compile(r"\b(?:we'?re\s+)?(?:cutting|dropping|de-?scoping|removing)\s+([^\n.!?]{4,200})", re.IGNORECASE)),
    ("scope_move", re.compile(r"\bmoving\s+([^\n]{2,80})\s+to\s+([^\n.!?]{2,80})", re.IGNORECASE)),
    ("scope_punt", re.compile(r"\b(?:punting|pushing|deferring|postponing)\s+([^\n]{2,80})\s+to\s+([^\n.!?]{2,80})", re.IGNORECASE)),
]


class SlackDecisionExtractor:
    id: ClassVar[str] = "slack.decision.regex"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("slack", "message")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        text = raw_payload.get("text") or ""
        if not text:
            return []

        out: list[ClaimCandidate] = []
        for key, pattern in _DECISION_PATTERNS:
            for m in pattern.finditer(text):
                snippet_start = max(0, m.start() - 30)
                snippet_end = min(len(text), m.end() + 30)
                value = m.group(0).strip()
                if len(value) > 240:
                    value = value[:240] + "…"
                out.append(
                    ClaimCandidate(
                        kind="decision" if key in {"decision_marker", "agreement"} else "scope",
                        key=key,
                        value=value,
                        value_norm=None,  # free text — no normalization here
                        confidence=0.5,
                        source_anchor={
                            "kind": "span",
                            "artifact_id": artifact_row.id,
                            "char_start": m.start(),
                            "char_end": m.end(),
                            "snippet": text[snippet_start:snippet_end],
                            "pattern": key,
                        },
                    )
                )
        return out
