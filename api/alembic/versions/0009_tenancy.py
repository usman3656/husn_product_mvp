"""tenancy: tenants, users, memberships, login_tokens, project_members
+ nullable tenant_id columns on data tables (C1 of TENANCY.md)

Additive only. The app keeps running unauthenticated on existing data.
The wipe + NOT NULL + unique-constraint re-keys land in 0010 at the C4
cutover, the same deploy that turns the login wall on.

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Data tables that gain a nullable tenant_id at C1 (NOT NULL at C4 / 0010).
TENANT_COLUMN_TABLES = [
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
    # ---------------- tenants ----------------
    op.create_table(
        "tenants",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_unique_constraint("uq_tenants_slug", "tenants", ["slug"])

    # ---------------- users ----------------
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Security audit only — rendered nowhere in product UI (anti-monitoring).
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint("uq_users_email", "users", ["email"])

    # ---------------- memberships (the company directory) ----------------
    op.create_table(
        "memberships",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False, server_default="member"),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="invited"),
        sa.Column("added_by", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("first_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint(
        "uq_membership_tenant_email", "memberships", ["tenant_id", "email"]
    )
    op.create_index("ix_membership_tenant_id", "memberships", ["tenant_id"])
    op.create_index("ix_membership_email", "memberships", ["email"])
    op.create_index("ix_membership_user_tenant", "memberships", ["user_id", "tenant_id"])

    # ---------------- login_tokens (magic links) ----------------
    op.create_table(
        "login_tokens",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint("uq_login_tokens_hash", "login_tokens", ["token_hash"])
    op.create_index("ix_login_tokens_email", "login_tokens", ["email"])

    # ---------------- project_members (viewer scoping, C6) ----------------
    op.create_table(
        "project_members",
        sa.Column("project_id", sa.BigInteger(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ---------------- nullable tenant_id on data tables ----------------
    for table in TENANT_COLUMN_TABLES:
        op.add_column(table, sa.Column("tenant_id", sa.BigInteger(), nullable=True))
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])

    # chat is per-user; admins get no override (anti-monitoring).
    op.add_column("chat_sessions", sa.Column("user_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_chat_sessions_user_id", "chat_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_sessions_user_id", table_name="chat_sessions")
    op.drop_column("chat_sessions", "user_id")

    for table in reversed(TENANT_COLUMN_TABLES):
        op.drop_index(f"ix_{table}_tenant_id", table_name=table)
        op.drop_column(table, "tenant_id")

    op.drop_table("project_members")

    op.drop_index("ix_login_tokens_email", table_name="login_tokens")
    op.drop_constraint("uq_login_tokens_hash", "login_tokens", type_="unique")
    op.drop_table("login_tokens")

    op.drop_index("ix_membership_user_tenant", table_name="memberships")
    op.drop_index("ix_membership_email", table_name="memberships")
    op.drop_index("ix_membership_tenant_id", table_name="memberships")
    op.drop_constraint("uq_membership_tenant_email", "memberships", type_="unique")
    op.drop_table("memberships")

    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_table("users")

    op.drop_constraint("uq_tenants_slug", "tenants", type_="unique")
    op.drop_table("tenants")
