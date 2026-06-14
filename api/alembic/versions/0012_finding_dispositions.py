"""finding_dispositions: TPM "this has been dealt with" decisions.

Keyed on the STABLE issue identity (tenant_id, rule_id, claim_group_id) — not
the finding row, which the drift evaluator recreates each tick — so a dealt-with
issue stays suppressed across re-evaluation. value_signature lets a genuinely
changed conflict resurface. Additive only.

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "finding_dispositions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=True),
        sa.Column("rule_id", sa.String(length=64), nullable=False),
        sa.Column("claim_group_id", sa.BigInteger(), nullable=False),
        sa.Column("value_signature", sa.String(length=64), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "rule_id", "claim_group_id",
            name="uq_disposition_tenant_rule_group",
        ),
    )
    op.create_index("ix_finding_dispositions_tenant_id", "finding_dispositions", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_finding_dispositions_tenant_id", table_name="finding_dispositions")
    op.drop_table("finding_dispositions")
