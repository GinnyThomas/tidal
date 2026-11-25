"""unique bank connection per user, provider and session

A BankSync refresh inserts a bank_connections row for each bank it hasn't
seen. Two refreshes running at once (two tabs) could both insert the same
bank; this constraint makes the second one fail (the router turns that into
a 409). NULL session_ids (pending consent-flow connections) are distinct in
PostgreSQL unique constraints, so they never clash.

No existing rows can break it: Enable Banking session ids are unique per
consent, and BankSync rows are new with this release.

Revision ID: a7c3e9f2b4d1
Revises: c74ecd8028e9
Create Date: 2026-11-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7c3e9f2b4d1'
down_revision: Union[str, Sequence[str], None] = 'c74ecd8028e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint(
        'uq_bank_connections_user_provider_session',
        'bank_connections',
        ['user_id', 'provider', 'session_id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('uq_bank_connections_user_provider_session', 'bank_connections', type_='unique')
