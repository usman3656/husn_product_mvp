"""claim_groups, findings, finding_evidence (Step 4 drift detection)

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "claim_groups",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "project_id", "kind", "key", name="uq_claim_group_project_kind_key"
        ),
    )
    op.create_index("ix_claim_group_project_id", "claim_groups", ["project_id"])

    op.create_table(
        "claim_group_members",
        sa.Column("claim_id", sa.BigInteger(), primary_key=True),
        sa.Column("claim_group_id", sa.BigInteger(), nullable=False),
    )
    op.create_index(
        "ix_claim_group_member_group_id", "claim_group_members", ["claim_group_id"]
    )

    op.create_table(
        "findings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("rule_id", sa.String(length=32), nullable=False),
        sa.Column("claim_group_id", sa.BigInteger(), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("severity", sa.String(length=16), nullable=False, server_default="medium"),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_finding_rule_id", "findings", ["rule_id"])
    op.create_index("ix_finding_status", "findings", ["status"])
    op.create_index("ix_finding_project_status", "findings", ["project_id", "status"])
    op.create_index("ix_finding_claim_group_id", "findings", ["claim_group_id"])

    # Enforce "at most one OPEN finding per (rule_id, claim_group_id)" so the
    # evaluator can upsert idempotently. Closed/snoozed findings don't block.
    op.create_index(
        "uq_open_finding_rule_group",
        "findings",
        ["rule_id", "claim_group_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )

    op.create_table(
        "finding_evidence",
        sa.Column("finding_id", sa.BigInteger(), primary_key=True),
        sa.Column("claim_id", sa.BigInteger(), primary_key=True),
        sa.Column("role", sa.String(length=16), nullable=False, server_default="primary"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("finding_evidence")
    op.drop_index("uq_open_finding_rule_group", table_name="findings")
    op.drop_index("ix_finding_claim_group_id", table_name="findings")
    op.drop_index("ix_finding_project_status", table_name="findings")
    op.drop_index("ix_finding_status", table_name="findings")
    op.drop_index("ix_finding_rule_id", table_name="findings")
    op.drop_table("findings")
    op.drop_index("ix_claim_group_member_group_id", table_name="claim_group_members")
    op.drop_table("claim_group_members")
    op.drop_index("ix_claim_group_project_id", table_name="claim_groups")
    op.drop_table("claim_groups")
