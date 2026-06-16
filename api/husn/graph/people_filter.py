"""Classify Person rows that should not surface as *teammates*.

The Teams lens (Explore) and the Organization map present "the people in your
organization". Rendering the raw `persons` table pollutes them three ways:

  1. **System / automation senders** — ``noreply@``, ``notifications@``,
     ``mailer-daemon``, LinkedIn / Microsoft / Google notification robots, and
     our own bot addresses. These are not colleagues.
  2. **Unresolved Slack identities** — a Slack ``@mention`` of a user we never
     saw a profile for creates a Person whose ``primary_name`` is still the raw
     id (``U08SX7Q02TE``). It has no human name to show.
  3. **Duplicate humans** — the email-first merge in ``graph.identity`` only
     fires when an email is present, so the same person created first from a
     no-email source and later from an email source can end up as two rows.

This module is a **display-time** filter: rows stay in the DB (the graph, the
drift evidence, and the admin merge/directory tool still need them). It only
decides what the people-facing surfaces show — which is what cleans data
*already* in the table (an ingest-time guard alone could never do that).
``is_system_account`` is the building block for an additional ingest-time skip
in the email normalizers (so robots never get created in the first place); that
wiring is a follow-up and is not in place yet.

Precision over recall: every rule keys off a high-signal marker (a robot
local-part, a known notification domain, a raw-id-shaped name) so we never hide
a real colleague. Genuinely distinct display-name variants of one human with no
shared email are left to the admin directory/merge tool by design.
"""

from __future__ import annotations

import re
from typing import Iterable

# Local-part tokens that mark an address as automated rather than a person.
# Matched as substrings of the lowercased local-part (text before the @), so
# ``account-security-noreply`` and ``comments-noreply`` both hit ``noreply``.
_SYSTEM_LOCALPART_TOKENS: tuple[str, ...] = (
    "noreply",
    "no-reply",
    "no_reply",
    "donotreply",
    "do-not-reply",
    "do_not_reply",
    "notification",  # also covers "notifications"
    "mailer-daemon",
    "mailerdaemon",
    "postmaster",
    "bounce",  # bounce, bounces
    "auto-confirm",
    "automated",
)

# Domains (or domain suffixes) that only deliver robot mail in this product's
# context. Kept deliberately small and well-known to avoid hiding real people.
_SYSTEM_DOMAIN_SUFFIXES: tuple[str, ...] = (
    "linkedin.com",
    "bounce.linkedin.com",
    "e.linkedin.com",
    "accountprotection.microsoft.com",
    "email.microsoftonline.com",
)

# A Person whose name is still the raw source id looks like this (Slack user
# ids start U/W, bot ids start B; all upper-case + digits, 6+ chars).
_RAW_SOURCE_ID_RE = re.compile(r"^[UWB][A-Z0-9]{6,}$")


def _localpart_domain(email: str | None) -> tuple[str, str]:
    if not email or "@" not in email:
        return "", ""
    local, _, domain = email.strip().lower().partition("@")
    return local, domain


def is_system_email(email: str | None) -> bool:
    """True for noreply/notification/daemon-style addresses and robot domains."""
    local, domain = _localpart_domain(email)
    if not domain:
        return False
    if any(domain == d or domain.endswith("." + d) for d in _SYSTEM_DOMAIN_SUFFIXES):
        return True
    return any(tok in local for tok in _SYSTEM_LOCALPART_TOKENS)


def is_raw_source_id(name: str | None) -> bool:
    """True when a name is still an unresolved source id like ``U08SX7Q02TE``."""
    return bool(name and _RAW_SOURCE_ID_RE.match(name.strip()))


def is_system_account(
    *,
    name: str | None,
    email: str | None,
    source: str | None = None,
    source_user_id: str | None = None,
) -> bool:
    """Should this identity be skipped at ingest as a non-human sender?

    Intended for the email normalizers to call before creating a Person (so
    robots never enter the graph). Covers robot emails and Slack *bot* ids
    (``B...``). Not yet wired in — the serve-time filter currently carries the
    user-visible fix; see the module docstring.
    """
    if is_system_email(email):
        return True
    if source == "slack" and source_user_id and source_user_id.upper().startswith("B"):
        return True
    return False


def is_displayable_person(
    *, primary_name: str | None, primary_email: str | None
) -> bool:
    """Should this Person appear on the people-facing surfaces?

    Excludes robot senders and rows that never resolved past a raw source id.
    """
    if is_system_email(primary_email):
        return False
    # A raw-id name with no email to fall back to is not presentable as a human.
    if is_raw_source_id(primary_name) and not primary_email:
        return False
    return True


def _name_quality(name: str | None) -> int:
    """Higher = a better display name. Real names beat raw ids beat blanks."""
    if not name:
        return 0
    if is_raw_source_id(name):
        return 1
    return 2 + len(name)


def dedupe_and_filter(persons: Iterable[dict]) -> list[dict]:
    """Filter system/unresolved rows, then collapse same-email duplicates.

    `persons` are the serialized dicts ``{id, primary_name, primary_email,
    identities: [...]}`` already produced by the API. Email dedup is safe — a
    shared (lowercased) email is the same human under the existing merge
    heuristic — and merges each duplicate's identities into the survivor. The
    survivor keeps the best display name and the lowest id (stable ordering).
    """
    displayable = [
        p
        for p in persons
        if is_displayable_person(
            primary_name=p.get("primary_name"), primary_email=p.get("primary_email")
        )
    ]

    by_email: dict[str, dict] = {}
    out: list[dict] = []
    for p in displayable:
        email = (p.get("primary_email") or "").strip().lower()
        if not email:
            out.append(p)
            continue
        existing = by_email.get(email)
        if existing is None:
            by_email[email] = p
            out.append(p)
            continue
        # Merge into the survivor: union identities, keep the better name + id.
        seen = {
            (i.get("source"), i.get("source_user_id")) for i in existing.get("identities", [])
        }
        for ident in p.get("identities", []):
            if (ident.get("source"), ident.get("source_user_id")) not in seen:
                existing.setdefault("identities", []).append(ident)
        if _name_quality(p.get("primary_name")) > _name_quality(existing.get("primary_name")):
            existing["primary_name"] = p.get("primary_name")
        existing["id"] = min(existing["id"], p["id"])
    return out
