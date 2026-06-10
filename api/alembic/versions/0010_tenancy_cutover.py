"""tenancy cutover: wipe pre-tenancy data, set tenant_id NOT NULL,
re-key global unique constraints per-tenant (C4 of TENANCY.md).

THIS MIGRATION DELETES ALL DATA in the pipeline tables (founder-approved
2026-06-10: "remove existing companies data and i will make my company
account the same way"). It ships in the same deploy that flips
AUTH_REQUIRED=1, so the wipe and the login wall land together. After it
runs, the founder signs up through the normal create-workspace flow and
reconnects the four tools; backfills repopulate within the hour.

Auth/directory tables (tenants, users, memberships, login_tokens) are NOT
wiped — accounts created before the flip survive. NOTE: project_members IS
emptied via the CASCADE from projects (its rows reference wiped projects, so
this is correct); memberships/roles are untouched.

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Order matters only for readability — TRUNCATE ... CASCADE handles refs.
DATA_TABLES = [
    "briefs",
    "agent_runs",
    "chat_messages",
    "chat_sessions",
    "finding_evidence",
    "findings",
    "claim_group_members",
    "claim_groups",
    "claims",
    "artifact_mentions",
    "artifacts",
    "person_identities",
    "persons",
    "project_sources",
    "projects",
    "raw_artifacts",
    "connections",
]

# Tables whose tenant_id flips to NOT NULL at cutover. chat_messages /
# join tables derive tenancy via parents and stay without the column.
NOT_NULL_TABLES = [
    "raw_artifacts",
    "connections",
    "persons",
    "person_identities",
    "projects",
    "claim_groups",
    "agent_runs",
    "chat_sessions",
    "briefs",
    "artifacts",
    "claims",
    "findings",
]


def upgrade() -> None:
    # ---------------- 1. Wipe pre-tenancy data ----------------
    op.execute("TRUNCATE TABLE " + ", ".join(DATA_TABLES) + " RESTART IDENTITY CASCADE")

    # ---------------- 2. tenant_id NOT NULL ----------------
    for table in NOT_NULL_TABLES:
        op.alter_column(table, "tenant_id", existing_type=sa.BigInteger(), nullable=False)
    # chat user linkage also becomes mandatory.
    op.alter_column("chat_sessions", "user_id", existing_type=sa.BigInteger(), nullable=False)

    # ---------------- 3. Re-key global unique constraints per-tenant -------
    # connections: (source, account_id) -> (tenant_id, source, account_id)
    op.drop_constraint("uq_connection_source_account", "connections", type_="unique")
    op.create_unique_constraint(
        "uq_connection_tenant_source_account",
        "connections",
        ["tenant_id", "source", "account_id"],
    )

    # raw_artifacts: (source, external_id, version) -> + tenant_id
    op.drop_constraint("uq_raw_artifact_source_extid_ver", "raw_artifacts", type_="unique")
    op.create_unique_constraint(
        "uq_raw_artifact_tenant_source_extid_ver",
        "raw_artifacts",
        ["tenant_id", "source", "external_id", "version"],
    )

    # person_identities: (source, source_user_id) -> + tenant_id
    op.drop_constraint("uq_identity_source_user", "person_identities", type_="unique")
    op.create_unique_constraint(
        "uq_identity_tenant_source_user",
        "person_identities",
        ["tenant_id", "source", "source_user_id"],
    )

    # projects: slug -> (tenant_id, slug)
    op.drop_constraint("projects_slug_key", "projects", type_="unique")
    op.create_unique_constraint("uq_project_tenant_slug", "projects", ["tenant_id", "slug"])

    # project_sources: (source, scope_kind, scope_id) -> + project (which is
    # tenant-scoped); keep the constraint name used by ON CONFLICT in code.
    op.drop_constraint("uq_project_source_scope", "project_sources", type_="unique")
    op.create_unique_constraint(
        "uq_project_source_scope",
        "project_sources",
        ["project_id", "source", "scope_kind", "scope_id"],
    )

    # claim_groups: (project_id, kind, key) -> + tenant_id (covers NULL-project
    # org-level groups, which would otherwise collide across tenants)
    op.drop_constraint("uq_claim_group_project_kind_key", "claim_groups", type_="unique")
    op.create_unique_constraint(
        "uq_claim_group_tenant_project_kind_key",
        "claim_groups",
        ["tenant_id", "project_id", "kind", "key"],
    )


def downgrade() -> None:
    # Data cannot be un-wiped. Downgrade restores only the schema shape.
    op.drop_constraint("uq_claim_group_tenant_project_kind_key", "claim_groups", type_="unique")
    op.create_unique_constraint(
        "uq_claim_group_project_kind_key", "claim_groups", ["project_id", "kind", "key"]
    )
    op.drop_constraint("uq_project_source_scope", "project_sources", type_="unique")
    op.create_unique_constraint(
        "uq_project_source_scope", "project_sources", ["source", "scope_kind", "scope_id"]
    )
    op.drop_constraint("uq_project_tenant_slug", "projects", type_="unique")
    op.create_unique_constraint("projects_slug_key", "projects", ["slug"])
    op.drop_constraint("uq_identity_tenant_source_user", "person_identities", type_="unique")
    op.create_unique_constraint(
        "uq_identity_source_user", "person_identities", ["source", "source_user_id"]
    )
    op.drop_constraint("uq_raw_artifact_tenant_source_extid_ver", "raw_artifacts", type_="unique")
    op.create_unique_constraint(
        "uq_raw_artifact_source_extid_ver",
        "raw_artifacts",
        ["source", "external_id", "version"],
    )
    op.drop_constraint("uq_connection_tenant_source_account", "connections", type_="unique")
    op.create_unique_constraint(
        "uq_connection_source_account", "connections", ["source", "account_id"]
    )

    op.alter_column("chat_sessions", "user_id", existing_type=sa.BigInteger(), nullable=True)
    for table in reversed(NOT_NULL_TABLES):
        op.alter_column(table, "tenant_id", existing_type=sa.BigInteger(), nullable=True)
