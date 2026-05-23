from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from husn.db.base import Base


class RawArtifact(Base):
    """
    Raw, source-shaped ingested record. One row per (source, external_id, version).

    Normalization into the operational graph happens in Step 2; for Step 1
    we only persist what each connector returns, verbatim.
    """

    __tablename__ = "raw_artifacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(256), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False, default="1")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("source", "external_id", "version", name="uq_raw_artifact_source_extid_ver"),
        Index("ix_raw_artifact_source_kind", "source", "kind"),
        Index("ix_raw_artifact_fetched_at", "fetched_at"),
    )


class Connection(Base):
    """
    Per-source OAuth connection. One row per (source, account_id) where
    account_id is source-specific (Atlassian cloudId, Slack workspace id, etc.).

    Tokens are stored as plaintext for local MVP. Production must move them
    to a KMS-backed secret store; flagged in plan.md sec. "What is NOT in this plan."
    """

    __tablename__ = "connections"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    account_id: Mapped[str] = mapped_column(String(128), nullable=False)
    account_label: Mapped[str | None] = mapped_column(String(256))
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("source", "account_id", name="uq_connection_source_account"),
    )


class Person(Base):
    """A human, normalized across sources. Identity resolution is best-effort
    and live-mergeable — see PersonIdentity.
    """

    __tablename__ = "persons"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    primary_name: Mapped[str] = mapped_column(String(256), nullable=False)
    primary_email: Mapped[str | None] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (Index("ix_person_email_lower", func.lower(primary_email)),)


class PersonIdentity(Base):
    """One (source, source_user_id) → one Person. A Person can have many
    identities — e.g. same human as a slack user + a jira account + a Google
    account. Email-first merge heuristic populates these; admin merge tool later.
    """

    __tablename__ = "person_identities"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    person_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_user_id: Mapped[str] = mapped_column(String(256), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(256))
    email: Mapped[str | None] = mapped_column(String(256))
    extra: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("source", "source_user_id", name="uq_identity_source_user"),
    )


class Project(Base):
    """User-curated husn.io 'project' — a logical bucket that aggregates Slack
    channels, Jira projects, etc. Step 1 auto-creates a default 'All work'.
    """

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ProjectSource(Base):
    """A (project, source, scope) attachment. E.g. project Atlas <-
    slack channel C0123, jira project ATL. Used to route artifacts to projects.
    """

    __tablename__ = "project_sources"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    scope_kind: Mapped[str] = mapped_column(String(32), nullable=False)  # channel|project
    scope_id: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "source", "scope_kind", "scope_id", name="uq_project_source_scope"
        ),
    )


class Artifact(Base):
    """Normalized artifact projected from a raw_artifact. Persisted (not a view)
    so downstream Step 3 claims can FK to a stable id. Re-runnable via the
    raw_artifact_id back-reference.
    """

    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    raw_artifact_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    project_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(256), nullable=False)
    title: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    author_person_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(String(64))
    extra: Mapped[dict | None] = mapped_column(JSONB)
    normalized_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    claims_extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claims_extractor_version: Mapped[int | None] = mapped_column()

    __table_args__ = (
        Index("ix_artifact_source_kind", "source", "kind"),
        Index("ix_artifact_project_occurred", "project_id", "occurred_at"),
    )


class ArtifactMention(Base):
    """Which people are referenced by an artifact, and in what role.
    Step 4 drift detection traverses this to find affected teams.
    """

    __tablename__ = "artifact_mentions"

    artifact_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    person_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), primary_key=True)  # author|assignee|mention|watcher
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Claim(Base):
    """A structured fact pulled from one Artifact.

    kind: date | owner | status | scope | decision | dependency
    key:  semantic label within kind — e.g. for date the key might be
          "duedate" (Jira structured) or "launch" (extracted from text);
          for owner the key is the role ("assignee","author","mentioned").
    value: normalized value (ISO date string, person id, status text, ...).
    confidence: 0.0–1.0; structured fields → ~1.0, regex matches → 0.5–0.8.
    source_anchor: JSONB pointer back to the verbatim source span:
      {kind: "field",  artifact_id, field_path: "fields.duedate"} or
      {kind: "span",   artifact_id, char_start, char_end, snippet}
    extractor_version: bump to force re-extraction on rule changes.

    Idempotent upsert key:
      (source_artifact_id, kind, key, extractor_id, extractor_version)
    """

    __tablename__ = "claims"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    source_artifact_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[str | None] = mapped_column(Text)
    value_norm: Mapped[str | None] = mapped_column(Text)  # normalized form for grouping (e.g. ISO date)
    status: Mapped[str | None] = mapped_column(String(32))  # active|superseded|stale (Step 4 will set)
    confidence: Mapped[float] = mapped_column(nullable=False, default=1.0)
    source_anchor: Mapped[dict] = mapped_column(JSONB, nullable=False)
    extractor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    extractor_version: Mapped[int] = mapped_column(nullable=False, default=1)
    extracted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "source_artifact_id",
            "kind",
            "key",
            "extractor_id",
            "extractor_version",
            name="uq_claim_artifact_kind_key_extractor",
        ),
        Index("ix_claim_project_kind", "project_id", "kind"),
        Index("ix_claim_kind_key", "kind", "key"),
    )
