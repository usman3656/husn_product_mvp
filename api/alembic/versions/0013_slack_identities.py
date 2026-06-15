"""slack_identities: link a Slack user to a Husn account (per-user bot access).

Additive only.

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "slack_identities",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("slack_team_id", sa.String(length=32), nullable=False),
        sa.Column("slack_user_id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slack_team_id", "slack_user_id", name="uq_slack_identity_team_user"),
    )
    op.create_index("ix_slack_identities_user_id", "slack_identities", ["user_id"])
    op.create_index("ix_slack_identities_tenant_id", "slack_identities", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_slack_identities_tenant_id", table_name="slack_identities")
    op.drop_index("ix_slack_identities_user_id", table_name="slack_identities")
    op.drop_table("slack_identities")
