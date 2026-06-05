"""Commitment extractor.

Slack-only. Captures explicit first-person promises:
  "I'll send the deck tomorrow", "I will review the PR by Friday".

We gate strictly on first person — "we'll" / "they'll" / "X will" are NOT
commitments at this layer (they're collective intent at best). Author is
pulled off the message payload so value_norm can be keyed per-person, which
lets Step 4 dedupe "Jane promised X" repeated across two channels.
"""

import re
from typing import Any, ClassVar

from husn.claims.base import ClaimCandidate

# First-person gate inside the pattern so we never match "we'll" or "they'll".
# Word-boundary + (?<!\w) before 'i' guards against "hi will ship".
_COMMITMENT_RE = re.compile(
    r"""
    (?<!\w)i\s+(?:will|'?ll)\s+
    (?P<verb>send|review|finish|share|post|update|fix|ship|deliver)
    \s+(?:the\s+)?(?P<obj>[\w/-]+)
    .{0,40}?
    \b(?P<date>
        tomorrow | tonight | today |
        monday | tuesday | wednesday | thursday | friday | saturday | sunday |
        by\s+\w+ | by\s+\d+
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


class SlackCommitmentExtractor:
    id: ClassVar[str] = "slack.commitment.regex"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("slack", "message")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        text = raw_payload.get("text") or ""
        if not text:
            return []
        author = raw_payload.get("user") or raw_payload.get("bot_id")

        out: list[ClaimCandidate] = []
        for m in _COMMITMENT_RE.finditer(text):
            verb = m.group("verb").strip().lower()
            obj = m.group("obj").strip()
            date_span = m.group("date").strip().lower()
            value = f"{verb} {obj} {date_span}"
            if author:
                value_norm = f"commit:{author}:{verb}:{obj.lower()}"
            else:
                # No author on this payload — still emit but don't risk
                # collapsing different people's promises into one group.
                value_norm = f"commit:?:{verb}:{obj.lower()}:{artifact_row.id}"
            snippet_start = max(0, m.start() - 20)
            snippet_end = min(len(text), m.end() + 20)
            out.append(
                ClaimCandidate(
                    kind="commitment",
                    key="commitment",
                    value=value,
                    value_norm=value_norm,
                    confidence=0.55,
                    source_anchor={
                        "kind": "span",
                        "artifact_id": artifact_row.id,
                        "char_start": m.start(),
                        "char_end": m.end(),
                        "snippet": text[snippet_start:snippet_end],
                        "verb": verb,
                        "author": author,
                    },
                )
            )
        return out
