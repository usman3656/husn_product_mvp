"""operational graph: persons, identities, projects, artifacts, mentions

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "persons",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("primary_name", sa.String(length=256), nullable=False),
        sa.Column("primary_email", sa.String(length=256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_person_email_lower", "persons", [sa.text("lower(primary_email)")])

    op.create_table(
        "person_identities",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("person_id", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_user_id", sa.String(length=256), nullable=False),
        sa.Column("display_name", sa.String(length=256), nullable=True),
        sa.Column("email", sa.String(length=256), nullable=True),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("source", "source_user_id", name="uq_identity_source_user"),
    )
    op.create_index("ix_person_identities_person_id", "person_identities", ["person_id"])

    op.create_table(
        "projects",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("slug", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "project_sources",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("project_id", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("scope_kind", sa.String(length=32), nullable=False),
        sa.Column("scope_id", sa.String(length=256), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "source", "scope_kind", "scope_id", name="uq_project_source_scope"
        ),
    )
    op.create_index("ix_project_sources_project_id", "project_sources", ["project_id"])

    op.create_table(
        "artifacts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("raw_artifact_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=256), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("author_person_id", sa.BigInteger(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "normalized_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_artifact_source_kind", "artifacts", ["source", "kind"])
    op.create_index("ix_artifact_project_occurred", "artifacts", ["project_id", "occurred_at"])
    op.create_index("ix_artifact_author_person_id", "artifacts", ["author_person_id"])
    op.create_index("ix_artifact_occurred_at", "artifacts", ["occurred_at"])

    op.create_table(
        "artifact_mentions",
        sa.Column("artifact_id", sa.BigInteger(), primary_key=True),
        sa.Column("person_id", sa.BigInteger(), primary_key=True),
        sa.Column("kind", sa.String(length=32), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_artifact_mentions_person_id", "artifact_mentions", ["person_id"])


def downgrade() -> None:
    op.drop_index("ix_artifact_mentions_person_id", table_name="artifact_mentions")
    op.drop_table("artifact_mentions")
    op.drop_index("ix_artifact_occurred_at", table_name="artifacts")
    op.drop_index("ix_artifact_author_person_id", table_name="artifacts")
    op.drop_index("ix_artifact_project_occurred", table_name="artifacts")
    op.drop_index("ix_artifact_source_kind", table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index("ix_project_sources_project_id", table_name="project_sources")
    op.drop_table("project_sources")
    op.drop_table("projects")
    op.drop_index("ix_person_identities_person_id", table_name="person_identities")
    op.drop_table("person_identities")
    op.drop_index("ix_person_email_lower", table_name="persons")
    op.drop_table("persons")
