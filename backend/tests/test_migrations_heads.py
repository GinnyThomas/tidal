# tests/test_migrations_heads.py
#
# Purpose: Catch two branches that each add a migration on the same parent.
#
# Each PR's migrations can be fine on their own, but once both are merged
# Alembic has two "heads" and `alembic upgrade head` refuses to run
# ("Multiple head revisions are present"). Reads the migration files only,
# so it needs no database and runs in the normal suite.

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_DIR = Path(__file__).resolve().parent.parent


def test_migrations_have_a_single_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    assert len(heads) == 1, (
        f"multiple Alembic heads {sorted(heads)}: add a merge migration with "
        f"`alembic merge -m 'merge heads' {' '.join(sorted(heads))}`"
    )
