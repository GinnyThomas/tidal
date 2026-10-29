# tests/test_migrations_rls.py
#
# Purpose: Prove the migrations lock every public table away from Supabase's
# Data API (PostgREST / supabase-js), which Tidal never uses — the frontend
# only talks to FastAPI.
#
# Supabase exposes the "public" schema over HTTP to its `anon` and
# `authenticated` roles. Without Row-Level Security, anyone holding the
# project's anon key could read and edit every table (Supabase advisor:
# rls_disabled_in_public). The app itself connects as `postgres`, the table
# owner, which RLS doesn't restrict — so locking these roles out costs nothing.
#
# Needs a real PostgreSQL (RLS and roles don't exist in SQLite), so it only
# runs when POSTGRES_TEST_URL points at a throwaway database you can DROP, e.g.
#   createdb tidal_migrations_test
#   POSTGRES_TEST_URL=postgresql://localhost/tidal_migrations_test \
#     python -m pytest tests/test_migrations_rls.py -v
# The connecting user must be able to CREATE ROLE (a local superuser can).

import os
import subprocess
import sys
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, text

POSTGRES_TEST_URL = os.environ.get("POSTGRES_TEST_URL")
BACKEND_DIR = Path(__file__).resolve().parent.parent
SUPABASE_API_ROLES = ("anon", "authenticated")

pytestmark = pytest.mark.skipif(
    not POSTGRES_TEST_URL, reason="set POSTGRES_TEST_URL to run migration tests"
)


def _alembic(*args: str) -> None:
    # Subprocess, so env.py reads DATABASE_URL from this env — never from .env,
    # which may point at production.
    env = {**os.environ, "DATABASE_URL": POSTGRES_TEST_URL or ""}
    subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR, env=env, check=True
    )


@pytest.fixture(scope="module")
def migrated_engine() -> Generator[Engine, None, None]:
    engine = create_engine(POSTGRES_TEST_URL or "")
    with engine.begin() as conn:
        # Start from an empty schema, then recreate Supabase's API roles
        # (a plain local Postgres doesn't have them).
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        for role in SUPABASE_API_ROLES:
            conn.execute(text(
                f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            ))
            # Mimic Supabase's old behaviour: API roles get access to everything.
            conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {role}"))
            conn.execute(text(
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO {role}"
            ))
    _alembic("upgrade", "head")
    yield engine
    engine.dispose()


def _public_tables(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        return list(conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )).scalars())


def test_every_public_table_has_row_level_security(migrated_engine: Engine) -> None:
    with migrated_engine.connect() as conn:
        without_rls = list(conn.execute(text(
            "SELECT c.relname FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity"
        )).scalars())

    assert "users" in _public_tables(migrated_engine)
    assert without_rls == []


@pytest.mark.parametrize("role", SUPABASE_API_ROLES)
def test_api_roles_have_no_table_privileges(migrated_engine: Engine, role: str) -> None:
    with migrated_engine.connect() as conn:
        granted = [
            table for table in _public_tables(migrated_engine)
            if conn.execute(
                text("SELECT has_table_privilege(:role, :table, 'SELECT,INSERT,UPDATE,DELETE')"),
                {"role": role, "table": f"public.{table}"},
            ).scalar()
        ]

    assert granted == []


@pytest.mark.parametrize("role", SUPABASE_API_ROLES)
def test_tables_created_later_are_not_granted_to_api_roles(
    migrated_engine: Engine, role: str
) -> None:
    """Default privileges revoked, so a future migration's new table stays private."""
    with migrated_engine.begin() as conn:
        conn.execute(text("CREATE TABLE public.future_table (id int)"))
        try:
            granted = conn.execute(
                text("SELECT has_table_privilege(:role, 'public.future_table', 'SELECT')"),
                {"role": role},
            ).scalar()
        finally:
            conn.execute(text("DROP TABLE public.future_table"))

    assert granted is False


def test_downgrade_then_upgrade_round_trips(migrated_engine: Engine) -> None:
    _alembic("downgrade", "-1")
    _alembic("upgrade", "head")

    assert "users" in _public_tables(migrated_engine)
