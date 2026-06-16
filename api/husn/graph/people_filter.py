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
    "infomails.microsoft.com",
    "notificationmail.microsoft.com",
)

# A domain whose FIRST label is one of these is a bulk/notification host
# (``infomails.microsoft.com``, ``em.acme.com``, ``mailer.x.com``). Real people
# don't receive personal mail at these — but a human's own company domain never
# starts with one of these labels, so this stays high-precision.
_NOTIFICATION_DOMAIN_LABELS: frozenset[str] = frozenset(
    {"infomails", "notificationmail", "notifications", "notification",
     "mailer", "mailers", "bounce", "bounces", "news", "newsletter", "em", "mktg"}
)

# Our own product / bot addresses — never a teammate.
_PRODUCT_SELF_MARKERS: tuple[str, ...] = ("husn.io", "husn.ai", "husunn.ai")

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
    if domain.split(".", 1)[0] in _NOTIFICATION_DOMAIN_LABELS:
        return True
    return any(tok in local for tok in _SYSTEM_LOCALPART_TOKENS)


def _alnum(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def is_service_account(name: str | None, email: str | None) -> bool:
    """True for brand/service senders named after their own address.

    A human's local-part rarely equals their display name (it carries dots,
    numbers, or initials): ``Usman Ghani`` ≠ ``usman120ghani``. A service does:
    ``Google Cloud`` == ``googlecloud@``, ``OneDrive`` == ``onedrive@``,
    ``Microsoft`` == ``microsoft@``. We also treat a row whose name simply *is*
    its email (never resolved to a human) as non-displayable.
    """
    local, _ = _localpart_domain(email)
    if not name or not local:
        return False
    if name.strip().lower() == (email or "").strip().lower():
        return True  # name is literally the address — unresolved sender
    return _alnum(name) == _alnum(local)


def is_product_self(name: str | None, email: str | None) -> bool:
    """True for our own product / bot identities (husn.io / husn.ai / HusunAI)."""
    _, domain = _localpart_domain(email)
    if domain and any(domain == m or domain.endswith("." + m) for m in _PRODUCT_SELF_MARKERS):
        return True
    blob = f"{_alnum(name)} {_alnum(email)}"
    return "husn" in blob or "husun" in blob


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
    if source == "slack" and source_user_id and (
        source_user_id.upper().startswith("B") or source_user_id.upper() == "USLACKBOT"
    ):
        return True
    return False


def is_displayable_person(
    *, primary_name: str | None, primary_email: str | None
) -> bool:
    """Should this Person appear on the people-facing surfaces?

    Excludes robot senders, brand/service accounts, our own product identities,
    and rows that never resolved past a raw source id.
    """
    if is_system_email(primary_email):
        return False
    if is_service_account(primary_name, primary_email):
        return False
    if is_product_self(primary_name, primary_email):
        return False
    # A raw-id name with no email to fall back to is not presentable as a human.
    if is_raw_source_id(primary_name) and not primary_email:
        return False
    return True


def _person_hidden(p: dict) -> bool:
    """Person-level filter: the name/email rules, plus bot identities (Slackbot,
    Slack ``B…`` bots) that carry no human email of their own."""
    if not is_displayable_person(
        primary_name=p.get("primary_name"), primary_email=p.get("primary_email")
    ):
        return True
    return any(
        is_system_account(
            name=None,
            email=i.get("email"),
            source=i.get("source"),
            source_user_id=i.get("source_user_id"),
        )
        for i in p.get("identities", [])
    )


def _name_quality(name: str | None) -> int:
    """Higher = a better display name. Real names beat raw ids beat blanks."""
    if not name:
        return 0
    if is_raw_source_id(name):
        return 1
    return 2 + len(name)


def _merge_into(survivor: dict, dup: dict) -> None:
    """Fold `dup` into `survivor`: union identities, keep the better name, the
    lowest id, and backfill a missing email."""
    seen = {
        (i.get("source"), i.get("source_user_id")) for i in survivor.get("identities", [])
    }
    for ident in dup.get("identities", []):
        if (ident.get("source"), ident.get("source_user_id")) not in seen:
            survivor.setdefault("identities", []).append(ident)
    if _name_quality(dup.get("primary_name")) > _name_quality(survivor.get("primary_name")):
        survivor["primary_name"] = dup.get("primary_name")
    if not survivor.get("primary_email") and dup.get("primary_email"):
        survivor["primary_email"] = dup.get("primary_email")
    survivor["id"] = min(survivor["id"], dup["id"])


def dedupe_and_filter(persons: Iterable[dict]) -> list[dict]:
    """Filter non-human rows, then collapse duplicates of the same human.

    `persons` are the serialized dicts ``{id, primary_name, primary_email,
    identities: [...]}`` produced by the API. Two dedup passes, both safe in a
    workspace:
      1. **same primary_email** — a shared (lowercased) email is the same human
         under the existing merge heuristic.
      2. **same exact display name** — identical full names ("Lamaan Haq" ×3
         created from sources with different/absent emails) that the email pass
         can't reach. Exact, case/space-insensitive only — never fuzzy — so
         distinct names like "Usman Ghani" vs "Usman Ghani Bawany" are left for
         the admin merge tool.
    Each merge unions identities and keeps the best name + lowest id.
    """
    displayable = [p for p in persons if not _person_hidden(p)]

    # Pass 1 — by shared email (primary OR any identity email). A shared email
    # is the same human, so this also reaches splits where one row's primary
    # email is null but an identity carries the address.
    by_email: dict[str, dict] = {}
    after_email: list[dict] = []
    for p in displayable:
        emails = {
            e.strip().lower()
            for e in [p.get("primary_email"), *(i.get("email") for i in p.get("identities", []))]
            if e and e.strip()
        }
        survivor = next((by_email[e] for e in emails if e in by_email), None)
        if survivor is None:
            after_email.append(p)
            for e in emails:
                by_email[e] = p
        else:
            _merge_into(survivor, p)
            for e in emails:
                by_email.setdefault(e, survivor)

    # Pass 2 — by exact normalized display name.
    by_name: dict[str, dict] = {}
    out: list[dict] = []
    for p in after_email:
        key = _alnum(p.get("primary_name"))
        existing = by_name.get(key) if key else None
        if existing is None:
            if key:
                by_name[key] = p
            out.append(p)
        else:
            _merge_into(existing, p)
    return out
