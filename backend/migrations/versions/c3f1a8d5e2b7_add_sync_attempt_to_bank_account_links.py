"""record each bank sync attempt and its error on the account link

The daily sync job (app/jobs/sync_bank_feeds.py) and the manual "Sync now"
both write these, so the Bank Feeds page can show a failed sync (e.g. an
expired BankSync API key) without anyone reading Railway logs.

Both columns are nullable, so existing rows need no default.

Revision ID: c3f1a8d5e2b7
Revises: a7c3e9f2b4d1
Create Date: 2026-11-25 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3f1a8d5e2b7'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f2b4d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('bank_account_links', sa.Column('last_sync_attempt_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('bank_account_links', sa.Column('last_sync_error', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('bank_account_links', 'last_sync_error')
    op.drop_column('bank_account_links', 'last_sync_attempt_at')
