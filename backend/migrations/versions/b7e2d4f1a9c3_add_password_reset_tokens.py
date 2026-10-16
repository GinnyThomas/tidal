"""add password reset tokens

Creates password_reset_tokens: one row per forgot-password request, storing a
SHA-256 hash of the emailed token (never the token itself), its expiry, and
when it was used.

Revision ID: b7e2d4f1a9c3
Revises: a3f8c1d92e05
Create Date: 2026-10-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e2d4f1a9c3'
down_revision: Union[str, Sequence[str], None] = 'a3f8c1d92e05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'password_reset_tokens',
        sa.Column('id', sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            'user_id',
            sa.Uuid(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True, index=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('password_reset_tokens')
