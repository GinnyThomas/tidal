"""merge bank feeds and data api hardening

Bank feeds (d1a8f3c5e7b9) and the Data API hardening (fe459eb10289) were
both written on top of 36f77bf75b7b, leaving two heads. No schema changes:
the result is the same whichever ran first, because 36f77bf75b7b had already
revoked the API roles' default privileges (so the bank feeds tables were never
granted to them), d1a8f3c5e7b9 enables RLS on its own tables, and
fe459eb10289 revokes the API roles' USAGE on the whole schema.

Revision ID: c74ecd8028e9
Revises: d1a8f3c5e7b9, fe459eb10289
Create Date: 2026-10-29 17:28:35.005194

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c74ecd8028e9'
down_revision: Union[str, Sequence[str], None] = ('d1a8f3c5e7b9', 'fe459eb10289')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
