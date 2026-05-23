"""raw_artifacts table

Revision ID: 0001
Revises:
Create Date: 2026-05-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "raw_artifacts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=256), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False, server_default="1"),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "source", "external_id", "version", name="uq_raw_artifact_source_extid_ver"
        ),
    )
    op.create_index(
        "ix_raw_artifact_source_kind", "raw_artifacts", ["source", "kind"]
    )
    op.create_index("ix_raw_artifact_fetched_at", "raw_artifacts", ["fetched_at"])


def downgrade() -> None:
    op.drop_index("ix_raw_artifact_fetched_at", table_name="raw_artifacts")
    op.drop_index("ix_raw_artifact_source_kind", table_name="raw_artifacts")
    op.drop_table("raw_artifacts")
