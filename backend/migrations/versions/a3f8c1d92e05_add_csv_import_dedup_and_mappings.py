"""add csv import dedup and mappings

Adds dedup_hash and external_id to transactions for import deduplication,
and creates the csv_mappings table for storing per-account column mappings.

Revision ID: a3f8c1d92e05
Revises: d4024ca2c007
Create Date: 2026-07-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f8c1d92e05'
down_revision: Union[str, Sequence[str], None] = 'd4024ca2c007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add dedup_hash to transactions: SHA-256 hex string computed on import
    # and on manual create. Nullable so existing rows are unaffected.
    op.add_column(
        'transactions',
        sa.Column('dedup_hash', sa.String(64), nullable=True, index=True),
    )

    # Add external_id: bank-provided transaction ID (e.g. Monzo tx_xxx).
    # Takes precedence over hash-based dedup when present.
    op.add_column(
        'transactions',
        sa.Column('external_id', sa.String(255), nullable=True, index=True),
    )

    # csv_mappings: stores the user's saved column→field mapping per account.
    # Unique constraint on (user_id, account_id) — one saved mapping per account.
    op.create_table(
        'csv_mappings',
        sa.Column('id', sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            'user_id',
            sa.Uuid(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column(
            'account_id',
            sa.Uuid(as_uuid=True),
            sa.ForeignKey('accounts.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column('name', sa.String(100), nullable=False),
        # JSONB in PostgreSQL, TEXT in SQLite for tests.
        # Stores the column→field map as a JSON object.
        sa.Column('mapping_json', sa.JSON(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint('user_id', 'account_id', name='uq_csv_mappings_user_account'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('csv_mappings')
    op.drop_column('transactions', 'external_id')
    op.drop_column('transactions', 'dedup_hash')
