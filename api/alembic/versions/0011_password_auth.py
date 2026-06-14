"""password auth: optional username + password credential on users.

Additive only. Adds three nullable columns to `users`:
  * username        — normalized lowercase, unique, immutable once set
  * password_hash   — bcrypt hash (NULL = no password set)
  * password_set_at — audit timestamp

The email magic link stays the primary entry + recovery path; this lets a
signed-in user set up a username+password once (in Settings) and then sign in
with it directly. No data is touched; existing accounts simply have NULLs.

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column("password_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Unique across all users; NULLs are allowed and not considered equal, so
    # accounts without a username don't collide.
    op.create_unique_constraint("uq_users_username", "users", ["username"])


def downgrade() -> None:
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "password_set_at")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "username")
