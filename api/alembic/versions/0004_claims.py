"""claims table + extraction markers on artifacts

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "claims",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("source_artifact_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("value_norm", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("source_anchor", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("extractor_id", sa.String(length=64), nullable=False),
        sa.Column("extractor_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "extracted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "source_artifact_id",
            "kind",
            "key",
            "extractor_id",
            "extractor_version",
            name="uq_claim_artifact_kind_key_extractor",
        ),
    )
    op.create_index("ix_claim_project_kind", "claims", ["project_id", "kind"])
    op.create_index("ix_claim_kind_key", "claims", ["kind", "key"])
    op.create_index("ix_claim_source_artifact_id", "claims", ["source_artifact_id"])

    op.add_column(
        "artifacts",
        sa.Column("claims_extracted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "artifacts", sa.Column("claims_extractor_version", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("artifacts", "claims_extractor_version")
    op.drop_column("artifacts", "claims_extracted_at")
    op.drop_index("ix_claim_source_artifact_id", table_name="claims")
    op.drop_index("ix_claim_kind_key", table_name="claims")
    op.drop_index("ix_claim_project_kind", table_name="claims")
    op.drop_table("claims")
