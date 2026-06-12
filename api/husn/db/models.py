from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from husn.db.base import Base

# ---------------------------------------------------------------------------
# Tenancy + auth (TENANCY.md, migration 0009).
#
# Model: Jira-style admin-provisioned directory.
#   * A tenant is a company workspace.
#   * memberships is the directory: the admin adds (email, role) rows BEFORE
#     the person ever logs in. The users row is created just-in-time on first
#     magic-link login and linked by exact-after-lowercase email match.
#   * tenant_id columns on data tables are NULLABLE until the C4 cutover
#     (migration 0010 truncates pre-tenancy data and sets NOT NULL).
# ---------------------------------------------------------------------------


class Tenant(Base):
    """A company workspace. Created via the self-serve create-workspace flow."""

    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class User(Base):
    """A person who can log in. Created just-in-time on first login.

    email is stored normalized (lowercase + trim) and matched exactly after
    that — NO gmail dot/plus canonicalization (a+x@ is a distinct identity).

    last_login_at exists for security audit ONLY and is rendered nowhere in
    product UI (anti-monitoring guardrail — see TENANCY.md §9).
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    name: Mapped[str | None] = mapped_column(String(256))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Membership(Base):
    """The company directory. One row per (tenant, email).

    status: invited  — admin added the email; person never logged in
            active   — person has logged in at least once
            removed  — admin removed them (soft; sessions killed immediately,
                       user row + chat history retained, re-adding the email
                       creates a FRESH membership — no auto-relink)
    role:   owner | admin | member
    user_id is NULL until first login (JIT user creation).
    """

    __tablename__ = "memberships"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="invited")
    added_by: Mapped[int | None] = mapped_column(BigInteger)  # user_id of the admin
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    first_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("tenant_id", "email", name="uq_membership_tenant_email"),
        Index("ix_membership_email", "email"),
        Index("ix_membership_user_tenant", "user_id", "tenant_id"),
    )


class LoginToken(Base):
    """A single-use magic-link token. We store only the SHA-256 of the token
    (a DB leak cannot forge logins). Atomic single-use via
    UPDATE ... SET used_at=now() WHERE token_hash=:h AND used_at IS NULL RETURNING.
    """

    __tablename__ = "login_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProjectMember(Base):
    """Which members can see a project. Admins/owners see all projects
    implicitly; this table scopes `member`-role visibility and the
    viewer_id parameter of the brief pipeline (C6).
    """

    __tablename__ = "project_members"

    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RawArtifact(Base):
    """
    Raw, source-shaped ingested record. One row per (source, external_id, version).

    Normalization into the operational graph happens in Step 2; for Step 1
    we only persist what each connector returns, verbatim.
    """

    __tablename__ = "raw_artifacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
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
        # Re-keyed per-tenant in migration 0010 (C4 cutover).
        UniqueConstraint(
            "tenant_id", "source", "external_id", "version",
            name="uq_raw_artifact_tenant_source_extid_ver",
        ),
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
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    account_id: Mapped[str] = mapped_column(String(128), nullable=False)
    account_label: Mapped[str | None] = mapped_column(String(256))
    # PROD-AUDIT: envelope-encrypt connection tokens before customer 1
    # (access_token + refresh_token are currently plaintext at rest; Bawani
    # to add an encrypted bytea column + KMS-backed DEK in a follow-up
    # Alembic migration. Single-tenant Hetzner deploy is acceptable risk.)
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
        # Re-keyed per-tenant in migration 0010 (C4 cutover).
        UniqueConstraint(
            "tenant_id", "source", "account_id", name="uq_connection_tenant_source_account"
        ),
    )


class Person(Base):
    """A human, normalized across sources. Identity resolution is best-effort
    and live-mergeable — see PersonIdentity.
    """

    __tablename__ = "persons"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
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
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
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
        # Re-keyed per-tenant in migration 0010 (C4 cutover).
        UniqueConstraint(
            "tenant_id", "source", "source_user_id", name="uq_identity_tenant_source_user"
        ),
    )


class Project(Base):
    """User-curated husn.io 'project' — a logical bucket that aggregates Slack
    channels, Jira projects, etc. Step 1 auto-creates a default 'All work'.
    """

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
    # Slug uniqueness is per-tenant since migration 0010 (C4 cutover).
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_project_tenant_slug"),
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
        # Since migration 0010 the scope key includes project_id, so two
        # tenants' projects can both attach the same Slack channel / Jira key.
        # Name kept stable — four ON CONFLICT callers reference it.
        UniqueConstraint(
            "project_id", "source", "scope_kind", "scope_id", name="uq_project_source_scope"
        ),
    )


class Artifact(Base):
    """Normalized artifact projected from a raw_artifact. Persisted (not a view)
    so downstream Step 3 claims can FK to a stable id. Re-runnable via the
    raw_artifact_id back-reference.
    """

    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
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
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
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


class ClaimGroup(Base):
    """A logical fact that multiple claims describe.

    Example: 'project=All-work, kind=date, key=launch' — every claim about
    the launch date for All-work belongs to this group. R-DATE-1 reads the
    set of distinct value_norm in a group and flags drift when >1.

    Identity: (project_id, kind, key). project_id NULL is allowed for
    org-level facts that aren't yet scoped to a project.
    """

    __tablename__ = "claim_groups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
    project_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Re-keyed per-tenant in migration 0010 (C4 cutover).
        UniqueConstraint(
            "tenant_id", "project_id", "kind", "key",
            name="uq_claim_group_tenant_project_kind_key",
        ),
    )


class ClaimGroupMember(Base):
    """Many claims → one group. One claim belongs to at most one group."""

    __tablename__ = "claim_group_members"

    claim_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_group_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


class Finding(Base):
    """A detected drift / conflict / unrecorded-decision event.

    rule_id: human-readable rule id ("R-DATE-1", "R-DECISION-1", ...)
    claim_group_id: the group whose claims disagreed
    status: open | closed | snoozed
    severity: low | medium | high
    summary: one-line human description ("launch date drift: 2026-06-03 vs 2026-06-10")

    A (rule_id, claim_group_id) pair has at most one OPEN finding at a time
    (enforced via partial unique index in the migration). On reconvergence the
    open finding is updated to closed; if drift recurs later, a new finding row
    is inserted with a fresh opened_at.
    """

    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
    rule_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    claim_group_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    project_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict | None] = mapped_column(JSONB)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_finding_status", "status"),
        Index("ix_finding_project_status", "project_id", "status"),
    )


class FindingEvidence(Base):
    """The verbatim source claims a finding cites.

    role: 'primary' for the canonical claims (the conflicting values),
          'supporting' for context (e.g. the artifact the doc claim came from).
    """

    __tablename__ = "finding_evidence"

    finding_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="primary")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AgentRun(Base):
    """One execution of the LLM agent. Per-run audit log: input/output token
    counts, model, status, error if any. Lets us track cost over time and
    debug failures.
    """

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
    project_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)  # cron|manual|on_change
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")  # running|ok|failed|rate_limited
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # ollama|groq|anthropic|claude-cli
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    input_tokens: Mapped[int | None] = mapped_column()
    output_tokens: Mapped[int | None] = mapped_column()
    duration_ms: Mapped[int | None] = mapped_column()
    finding_count: Mapped[int | None] = mapped_column()
    brief_count: Mapped[int | None] = mapped_column()
    error: Mapped[str | None] = mapped_column(Text)
    raw_response: Mapped[str | None] = mapped_column(Text)  # truncated dump for debugging


class ChatSession(Base):
    """One conversation thread with the agent, anchored to a project.

    Multiple sessions per project are allowed (think: one per topic).
    The session's `title` is auto-set from the first user message and can be
    edited later.
    """

    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
    # Chat is PER-USER: admins have no override into other members' sessions
    # (anti-monitoring guardrail — TENANCY.md §9). NOT NULL at C4.
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    project_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="(untitled)")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ChatMessage(Base):
    """One turn in a chat session. role ∈ {user, assistant, system}."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user|assistant|system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Assistant-only: which claims/artifacts the model cited (validated)
    cited_claim_ids: Mapped[list[int] | None] = mapped_column(JSONB)
    cited_artifact_ids: Mapped[list[int] | None] = mapped_column(JSONB)
    # Assistant-only: token + model accounting
    model: Mapped[str | None] = mapped_column(String(128))
    input_tokens: Mapped[int | None] = mapped_column()
    output_tokens: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Brief(Base):
    """A per-persona pre-meeting brief produced by the agent.

    content is a structured JSON document:
      {
        "headline": "Atlas launch date drift unresolved",
        "bullets": [
          {"text": "Slack #atlas-program says June 10; Target GA doc says June 3",
           "claim_ids": [7, 31]},
          ...
        ]
      }
    Every bullet's claim_ids are validated against the input dossier
    BEFORE the brief is persisted.
    """

    __tablename__ = "briefs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # NOT NULL at C4
    project_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    agent_run_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    persona: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source_claim_ids: Mapped[list[int]] = mapped_column(JSONB, nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_brief_project_persona", "project_id", "persona"),
        Index("ix_brief_generated_at", "generated_at"),
    )
