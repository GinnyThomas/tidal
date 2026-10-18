"""add bank feeds tables

Adds bank_connections (one Open Banking consent per bank) and
bank_account_links (each bank account in a consent, optionally linked to a
Tidal account). New tables only — no existing rows are touched.

Both get Row-Level Security with no policies, like every other public
table since 36f77bf75b7b: Supabase's Data API roles see nothing, and the
app (the table owner) is unaffected.

Revision ID: d1a8f3c5e7b9
Revises: 36f77bf75b7b
Create Date: 2026-10-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1a8f3c5e7b9'
down_revision: Union[str, Sequence[str], None] = '36f77bf75b7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bank_connections',
        sa.Column('id', sa.Uuid(as_uuid=True), nullable=False),
        sa.Column('user_id', sa.Uuid(as_uuid=True), nullable=False),
        sa.Column('provider', sa.String(length=30), nullable=False),
        sa.Column('institution_name', sa.String(length=100), nullable=False),
        sa.Column('institution_country', sa.String(length=2), nullable=False),
        sa.Column('state', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('session_id', sa.String(length=255), nullable=True),
        sa.Column('valid_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_bank_connections_user_id'), 'bank_connections', ['user_id'], unique=False)
    op.create_index(op.f('ix_bank_connections_state'), 'bank_connections', ['state'], unique=True)
    op.execute('ALTER TABLE public.bank_connections ENABLE ROW LEVEL SECURITY')

    op.create_table(
        'bank_account_links',
        sa.Column('id', sa.Uuid(as_uuid=True), nullable=False),
        sa.Column('connection_id', sa.Uuid(as_uuid=True), nullable=False),
        sa.Column('user_id', sa.Uuid(as_uuid=True), nullable=False),
        sa.Column('account_id', sa.Uuid(as_uuid=True), nullable=True),
        sa.Column('provider_account_uid', sa.String(length=255), nullable=False),
        sa.Column('identification_hash', sa.String(length=255), nullable=True),
        sa.Column('name', sa.String(length=100), nullable=True),
        sa.Column('currency', sa.String(length=3), nullable=True),
        sa.Column('iban_last4', sa.String(length=4), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['connection_id'], ['bank_connections.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_bank_account_links_connection_id'), 'bank_account_links', ['connection_id'], unique=False)
    op.create_index(op.f('ix_bank_account_links_user_id'), 'bank_account_links', ['user_id'], unique=False)
    op.create_index(op.f('ix_bank_account_links_account_id'), 'bank_account_links', ['account_id'], unique=False)
    op.execute('ALTER TABLE public.bank_account_links ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_bank_account_links_account_id'), table_name='bank_account_links')
    op.drop_index(op.f('ix_bank_account_links_user_id'), table_name='bank_account_links')
    op.drop_index(op.f('ix_bank_account_links_connection_id'), table_name='bank_account_links')
    op.drop_table('bank_account_links')
    op.drop_index(op.f('ix_bank_connections_state'), table_name='bank_connections')
    op.drop_index(op.f('ix_bank_connections_user_id'), table_name='bank_connections')
    op.drop_table('bank_connections')
