"""add schedules.deactivated_on

The annual plan includes inactive schedules on purpose (their past months are
real history), so it needs to know when each one stopped. Until now the only
bound was end_date, so an inactive schedule with no end date kept planning
every future month. Ending it by overwriting end_date would lose the user's
own end date (a loan or contract end) on pause → resume, so the stop date
gets its own column: set on active → inactive, cleared on reactivation.

Backfill: schedules already inactive get the date they were last updated.
That's the best record of when they were paused (an edit after pausing makes
it later, so at worst a few extra months stay planned, never fewer).

Revision ID: b8d2f4a6c1e3
Revises: a7c3e9f2b4d1
Create Date: 2026-11-25 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b8d2f4a6c1e3'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f2b4d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('schedules', sa.Column('deactivated_on', sa.Date(), nullable=True))
    op.execute(
        "UPDATE schedules "
        "SET deactivated_on = (updated_at AT TIME ZONE 'UTC')::date "
        "WHERE active = false"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('schedules', 'deactivated_on')
