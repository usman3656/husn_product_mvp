"""Slack normalizer: raw_artifact -> Artifact + ArtifactMention rows."""

import re
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from husn.db.models import Artifact, ArtifactMention, RawArtifact
from husn.graph.emoji import demojize_slack
from husn.graph.identity import resolve_or_create_person
from husn.graph.projects import resolve_project_for

_USER_MENTION_RE = re.compile(r"<@([UW][A-Z0-9]+)>")


def _message_title(channel_name: str | None, text: str) -> str | None:
    """A human-readable label for a Slack message artifact.

    Slack messages have no native title, so the connections file list used to
    fall back to the raw external id (``T…:message:C…:1781552448.5``). Build a
    ``#channel: first line of text…`` label instead. Returns None only when we
    have neither a channel nor any text to show.
    """
    snippet = " ".join((text or "").split())  # collapse newlines/runs of space
    if len(snippet) > 80:
        snippet = snippet[:79].rstrip() + "…"
    chan = f"#{channel_name}" if channel_name else None
    if chan and snippet:
        return f"{chan}: {snippet}"
    return chan or snippet or None


def _slack_ts_to_dt(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        seconds = float(ts)
    except (ValueError, TypeError):
        return None
    return datetime.fromtimestamp(seconds, tz=UTC)


async def normalize_slack_message(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    channel_id = payload.get("channel_id")
    channel_name = payload.get("channel_name")

    project_id = await resolve_project_for(
        session, source="slack", scope_kind="channel", scope_id=channel_id or ""
    )

    # Convert Slack emoji shortcodes (:white_check_mark:) to Unicode once, here,
    # so every downstream consumer (claims, drift evidence, briefs) gets clean
    # text instead of bare :shortcode: tokens.
    text = demojize_slack(payload.get("text") or "") or ""

    author_person_id: int | None = None
    author_user_id = payload.get("user") or payload.get("bot_id")
    if author_user_id and author_user_id.startswith(("U", "W")):
        author_person = await resolve_or_create_person(
            session,
            source="slack",
            source_user_id=author_user_id,
            display_name=payload.get("username"),
        )
        author_person_id = author_person.id

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=project_id,
        source="slack",
        kind="message",
        external_id=raw.external_id,
        title=_message_title(channel_name, text),
        body=text,
        author_person_id=author_person_id,
        occurred_at=_slack_ts_to_dt(payload.get("ts")),
        url=None,
        status=payload.get("subtype"),
        extra={
            "channel_id": channel_id,
            "channel_name": channel_name,
            "thread_ts": payload.get("thread_ts"),
            "reply_count": payload.get("reply_count"),
            "ts": payload.get("ts"),
        },
    )
    session.add(artifact)
    await session.flush()

    if author_person_id:
        session.add(
            ArtifactMention(
                artifact_id=artifact.id, person_id=author_person_id, kind="author"
            )
        )

    # @mentions inside the message body
    for uid in set(_USER_MENTION_RE.findall(text)):
        if uid == author_user_id:
            continue
        person = await resolve_or_create_person(
            session, source="slack", source_user_id=uid
        )
        session.add(
            ArtifactMention(artifact_id=artifact.id, person_id=person.id, kind="mention")
        )

    return artifact


async def normalize_slack_channel(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,
        source="slack",
        kind="channel",
        external_id=raw.external_id,
        title=payload.get("name"),
        body=(payload.get("purpose") or {}).get("value")
        or (payload.get("topic") or {}).get("value"),
        occurred_at=None,
        url=None,
        status="archived" if payload.get("is_archived") else "active",
        extra={
            "id": payload.get("id"),
            "is_member": payload.get("is_member"),
            "num_members": payload.get("num_members"),
        },
    )
    session.add(artifact)
    await session.flush()
    return artifact


async def normalize_slack_user(session: AsyncSession, raw: RawArtifact) -> Artifact:
    payload = raw.payload or {}
    profile = payload.get("profile") or {}
    email = profile.get("email")
    display_name = payload.get("real_name") or profile.get("real_name") or payload.get("name")

    # This is the canonical Slack user record — resolve/create the person now,
    # so later @mentions in messages prefer this email-bearing identity.
    person = await resolve_or_create_person(
        session,
        source="slack",
        source_user_id=payload["id"],
        display_name=display_name,
        email=email,
        extra={"is_admin": payload.get("is_admin"), "tz": payload.get("tz")},
    )

    artifact = Artifact(
        raw_artifact_id=raw.id,
        project_id=None,
        source="slack",
        kind="user",
        external_id=raw.external_id,
        title=display_name,
        body=profile.get("title"),
        author_person_id=person.id,
        occurred_at=None,
        url=None,
        status="deleted" if payload.get("deleted") else "active",
        extra={
            "slack_user_id": payload.get("id"),
            "email": email,
            "tz": payload.get("tz"),
        },
    )
    session.add(artifact)
    await session.flush()
    return artifact
