"""token_usage ledger + sync_settings (manual/auto sync). Additive.

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "token_usage",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_token_usage_tenant_id", "token_usage", ["tenant_id"])
    op.create_index("ix_token_usage_created_at", "token_usage", ["created_at"])

    op.create_table(
        "sync_settings",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # Seed the single global row in manual mode (no automatic sync until enabled).
    op.execute(
        "INSERT INTO sync_settings (id, mode, interval_minutes) "
        "VALUES (1, 'manual', 30) ON CONFLICT (id) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_table("sync_settings")
    op.drop_index("ix_token_usage_created_at", table_name="token_usage")
    op.drop_index("ix_token_usage_tenant_id", table_name="token_usage")
    op.drop_table("token_usage")
