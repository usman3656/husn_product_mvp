"""agent_runs + briefs (Step 6)

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("finding_count", sa.Integer(), nullable=True),
        sa.Column("brief_count", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("raw_response", sa.Text(), nullable=True),
    )
    op.create_index("ix_agent_runs_project_id", "agent_runs", ["project_id"])
    op.create_index("ix_agent_runs_started_at", "agent_runs", ["started_at"])

    op.create_table(
        "briefs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("agent_run_id", sa.BigInteger(), nullable=False),
        sa.Column("persona", sa.String(length=64), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_claim_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_brief_project_persona", "briefs", ["project_id", "persona"])
    op.create_index("ix_brief_generated_at", "briefs", ["generated_at"])
    op.create_index("ix_briefs_project_id", "briefs", ["project_id"])
    op.create_index("ix_briefs_agent_run_id", "briefs", ["agent_run_id"])


def downgrade() -> None:
    op.drop_index("ix_briefs_agent_run_id", table_name="briefs")
    op.drop_index("ix_briefs_project_id", table_name="briefs")
    op.drop_index("ix_brief_generated_at", table_name="briefs")
    op.drop_index("ix_brief_project_persona", table_name="briefs")
    op.drop_table("briefs")
    op.drop_index("ix_agent_runs_started_at", table_name="agent_runs")
    op.drop_index("ix_agent_runs_project_id", table_name="agent_runs")
    op.drop_table("agent_runs")
