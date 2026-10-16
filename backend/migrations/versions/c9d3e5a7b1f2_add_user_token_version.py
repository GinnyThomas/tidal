"""add user token version

Adds users.token_version, copied into every JWT as the `ver` claim so a
password reset can revoke all existing sessions by incrementing it.

Revision ID: c9d3e5a7b1f2
Revises: b7e2d4f1a9c3
Create Date: 2026-10-16 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d3e5a7b1f2'
down_revision: Union[str, Sequence[str], None] = 'b7e2d4f1a9c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # NOT NULL needs a server_default so existing users get 0 — which matches
    # tokens already in browsers (no `ver` claim → treated as 0).
    op.add_column(
        'users',
        sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'token_version')
