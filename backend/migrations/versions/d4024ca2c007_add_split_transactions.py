"""add split transactions

Revision ID: d4024ca2c007
Revises: fe8742549a1e
Create Date: 2026-05-01 14:19:24.330798

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4024ca2c007'
down_revision: Union[str, Sequence[str], None] = 'fe8742549a1e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add is_split flag to transactions
    op.add_column('transactions', sa.Column('is_split', sa.Boolean(), server_default='false', nullable=False))

    # Create transaction_splits table
    op.create_table(
        'transaction_splits',
        sa.Column('id', sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column('transaction_id', sa.Uuid(as_uuid=True), sa.ForeignKey('transactions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('category_id', sa.Uuid(as_uuid=True), sa.ForeignKey('categories.id'), nullable=True),
        sa.Column('promotion_id', sa.Uuid(as_uuid=True), sa.ForeignKey('promotions.id'), nullable=True),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('transaction_splits')
    op.drop_column('transactions', 'is_split')
