"""Date extractors.

Two strategies:
  1. Structured field (Jira fields.duedate, fields.customfield_*_date if present)
     → confidence 1.0
  2. Natural-language pattern in free text (Jira description, Slack message body)
     → dateparser, but **only when the date is anchored by an intent verb**
     (ship/launch/release/deadline/due). Bare dates ("see you June 10") are
     not promoted to claims — too noisy for drift detection.

The pattern that matters for Step 4 drift:
  "launch on June 10", "we're moving the date to June 10", "ship by 06/10",
  "deadline: June 3", "going live next Friday".
"""

import re
from datetime import UTC, date, datetime
from typing import Any, ClassVar

import dateparser

from husn.claims.base import ClaimCandidate
from husn.graph.normalizers.jira import _extract_text_from_adf

# Intent verbs / nouns that gate NL date extraction. The group right after
# the verb is the date span we hand to dateparser.
_INTENT_RE = re.compile(
    r"""
    \b
    (?P<intent>
        launch(?:\ date)? | ship(?:ping)? | shipping\ date | release(?:\ date)? |
        go(?:ing)?\ live | rollout | rolling\ out |
        deadline | due(?:\ date)? | target(?:\ date)? | cut[\s-]?over |
        moving\ (?:the\ )?(?:date|launch|deadline)\ to |
        push(?:ing|ed)?\ (?:to|back\ to) |
        slipped\ to | slip\ to | now\ (?:ship|launch|release)s?(?:\ on)?
    )
    \b
    [^\n.!?]{0,80}?   # at most 80 chars between intent and date
    (?P<date>
        (?:\d{4}-\d{2}-\d{2}) |                                              # 2026-06-10
        (?:\d{1,2}/\d{1,2}(?:/\d{2,4})?) |                                   # 6/10 or 06/10/2026
        (?:                                                                  # month-day forms
          (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*
          \s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?
        ) |
        (?:\d{1,2}(?:st|nd|rd|th)?\s+                                        # 10 June 2026
          (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*
          (?:\s+\d{4})?
        ) |
        (?:(?:next|this|last)\ (?:week|month|year|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*) |
        (?:tomorrow|today|tonight)
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

_INTENT_NORMALIZE = {
    "launch": "launch",
    "launch date": "launch",
    "ship": "ship",
    "shipping": "ship",
    "shipping date": "ship",
    "release": "release",
    "release date": "release",
    "go live": "launch",
    "going live": "launch",
    "rollout": "rollout",
    "rolling out": "rollout",
    "deadline": "deadline",
    "due": "deadline",
    "due date": "deadline",
    "target": "target",
    "target date": "target",
    "cutover": "cutover",
    "cut-over": "cutover",
    "cut over": "cutover",
}

_DATEPARSER_SETTINGS = {
    "RETURN_AS_TIMEZONE_AWARE": True,
    "PREFER_DATES_FROM": "future",
    "TIMEZONE": "UTC",
    "TO_TIMEZONE": "UTC",
}


def _normalize_key(intent_phrase: str) -> str:
    intent_phrase = intent_phrase.lower().strip()
    for prefix, normalized in _INTENT_NORMALIZE.items():
        if intent_phrase.startswith(prefix):
            return normalized
    return intent_phrase.split()[0]


def _parse_date(span: str) -> date | None:
    parsed = dateparser.parse(span, settings=_DATEPARSER_SETTINGS)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.date()


def _extract_nl(text: str, *, artifact_id: int) -> list[ClaimCandidate]:
    out: list[ClaimCandidate] = []
    for m in _INTENT_RE.finditer(text):
        intent_raw = m.group("intent").strip().lower()
        key = _normalize_key(intent_raw)
        date_span = m.group("date")
        d = _parse_date(date_span)
        if d is None:
            continue
        snippet_start = max(0, m.start() - 20)
        snippet_end = min(len(text), m.end() + 20)
        out.append(
            ClaimCandidate(
                kind="date",
                key=key,
                value=date_span,
                value_norm=d.isoformat(),
                confidence=0.7,
                source_anchor={
                    "kind": "span",
                    "artifact_id": artifact_id,
                    "char_start": m.start(),
                    "char_end": m.end(),
                    "snippet": text[snippet_start:snippet_end],
                    "intent": intent_raw,
                },
            )
        )
    return out


class JiraDateExtractor:
    """Jira: duedate field (structured) + NL extraction from summary + description."""

    id: ClassVar[str] = "jira.date"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("jira", "issue")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        fields = raw_payload.get("fields") or {}
        out: list[ClaimCandidate] = []

        duedate = fields.get("duedate")
        if duedate:
            try:
                d = datetime.fromisoformat(duedate).date()
                out.append(
                    ClaimCandidate(
                        kind="date",
                        key="deadline",
                        value=duedate,
                        value_norm=d.isoformat(),
                        confidence=1.0,
                        source_anchor={
                            "kind": "field",
                            "artifact_id": artifact_row.id,
                            "field_path": "fields.duedate",
                        },
                    )
                )
            except ValueError:
                pass

        # Also walk summary + description for NL hits
        summary = fields.get("summary") or ""
        desc = fields.get("description")
        body_text = summary
        if isinstance(desc, dict):
            body_text = (body_text + "\n" + (_extract_text_from_adf(desc) or "")).strip()
        elif isinstance(desc, str):
            body_text = (body_text + "\n" + desc).strip()
        if body_text:
            out.extend(_extract_nl(body_text, artifact_id=artifact_row.id))

        return out


class SlackDateExtractor:
    """Slack message text → NL date claims gated by intent verbs."""

    id: ClassVar[str] = "slack.date.nl"
    version: ClassVar[int] = 1
    kinds: ClassVar[set[tuple[str, str]]] = {("slack", "message")}

    def extract(
        self, *, artifact_row: Any, raw_payload: dict[str, Any]
    ) -> list[ClaimCandidate]:
        text = raw_payload.get("text") or ""
        if not text:
            return []
        return _extract_nl(text, artifact_id=artifact_row.id)
