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
# CI runs it against a Postgres service (.github/workflows/migrations.yml).

import os
import subprocess
import sys
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.exc import ProgrammingError

POSTGRES_TEST_URL = os.environ.get("POSTGRES_TEST_URL")
BACKEND_DIR = Path(__file__).resolve().parent.parent
SUPABASE_API_ROLES = ("anon", "authenticated")
# Supabase's own admin role also has default privileges granting the API
# roles access to anything it creates in public.
SUPABASE_ADMIN_ROLE = "supabase_admin"
LOCAL_HOSTS = (None, "", "localhost", "127.0.0.1", "::1")
INSUFFICIENT_PRIVILEGE = "42501"

pytestmark = pytest.mark.skipif(
    not POSTGRES_TEST_URL, reason="set POSTGRES_TEST_URL to run migration tests"
)


def _assert_throwaway_database(url: str) -> None:
    """The fixture drops the public schema, so refuse anything but a local test DB."""
    parsed = make_url(url)
    if parsed.host not in LOCAL_HOSTS or "test" not in (parsed.database or ""):
        pytest.fail(
            "POSTGRES_TEST_URL must be a local database with 'test' in its name "
            f"(got host={parsed.host!r}, database={parsed.database!r}) — "
            "this test drops the public schema"
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
    _assert_throwaway_database(POSTGRES_TEST_URL or "")
    engine = create_engine(POSTGRES_TEST_URL or "")
    with engine.begin() as conn:
        # Start from an empty schema, then recreate Supabase's roles and grants
        # (a plain local Postgres doesn't have them).
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        # A fresh schema has no grants; Supabase's public schema is usable by PUBLIC.
        conn.execute(text("GRANT USAGE ON SCHEMA public TO PUBLIC"))
        for role in (*SUPABASE_API_ROLES, SUPABASE_ADMIN_ROLE):
            conn.execute(text(
                f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            ))
        conn.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {SUPABASE_ADMIN_ROLE}"))
        api_roles = ", ".join(SUPABASE_API_ROLES)
        conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {api_roles}"))
        # Mimic Supabase's old behaviour: API roles get access to everything
        # created by either the migrating role or supabase_admin.
        for creator in ("CURRENT_USER", SUPABASE_ADMIN_ROLE):
            for kind in ("TABLES", "SEQUENCES", "FUNCTIONS"):
                conn.execute(text(
                    f"ALTER DEFAULT PRIVILEGES FOR ROLE {creator} IN SCHEMA public "
                    f"GRANT ALL ON {kind} TO {api_roles}"
                ))
        # Objects that exist before the migration runs. Tidal's own tables use
        # UUID keys and define no functions, so add one of each.
        conn.execute(text("CREATE SEQUENCE public.existing_seq"))
        conn.execute(text(
            "CREATE FUNCTION public.existing_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'"
        ))
    _alembic("upgrade", "head")
    yield engine
    engine.dispose()


def _public_tables(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        return list(conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )).scalars())


def _denied_as(engine: Engine, role: str, sql: str) -> bool:
    """Run `sql` as `role`; True if Postgres refuses it for lack of privilege."""
    with engine.connect() as conn:
        # Not committed, so the rollback on close undoes the SET ROLE too.
        conn.execute(text(f"SET ROLE {role}"))
        try:
            conn.execute(text(sql))
        except ProgrammingError as error:
            if getattr(error.orig, "pgcode", None) == INSUFFICIENT_PRIVILEGE:
                return True
            raise
        return False


def _assert_locked_down(engine: Engine) -> None:
    """Every invariant the migration promises, checked as a whole."""
    with engine.connect() as conn:
        without_rls = list(conn.execute(text(
            "SELECT c.relname FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity"
        )).scalars())
        assert without_rls == []

        for role in SUPABASE_API_ROLES:
            params = {"role": role}
            assert conn.execute(text(
                "SELECT has_schema_privilege(:role, 'public', 'USAGE')"
            ), params).scalar() is False
            granted_tables = [
                table for table in _public_tables(engine)
                if conn.execute(
                    text("SELECT has_table_privilege(:role, :table, 'SELECT,INSERT,UPDATE,DELETE')"),
                    {**params, "table": f"public.{table}"},
                ).scalar()
            ]
            assert granted_tables == []
            assert conn.execute(text(
                "SELECT has_sequence_privilege(:role, 'public.existing_seq', 'USAGE,SELECT,UPDATE')"
            ), params).scalar() is False
            assert conn.execute(text(
                "SELECT has_function_privilege(:role, 'public.existing_fn()', 'EXECUTE')"
            ), params).scalar() is False

        # No default privilege left in public that hands anything to the API roles.
        leftover_defaults = list(conn.execute(text(
            "SELECT pg_get_userbyid(d.defaclrole) || ' ' || d.defaclobjtype::text "
            "FROM pg_default_acl d "
            "JOIN pg_namespace n ON n.oid = d.defaclnamespace "
            "CROSS JOIN LATERAL aclexplode(d.defaclacl) acl "
            "WHERE n.nspname = 'public' "
            "AND pg_get_userbyid(acl.grantee) IN ('anon', 'authenticated')"
        )).scalars())
        assert leftover_defaults == []

    # The app's role still reaches its own tables.
    with engine.connect() as conn:
        conn.execute(text("SELECT count(*) FROM public.users")).scalar()


def test_every_public_table_has_row_level_security(migrated_engine: Engine) -> None:
    assert "users" in _public_tables(migrated_engine)
    _assert_locked_down(migrated_engine)


@pytest.mark.parametrize("role", SUPABASE_API_ROLES)
def test_api_roles_cannot_read_existing_tables(migrated_engine: Engine, role: str) -> None:
    for table in _public_tables(migrated_engine):
        assert _denied_as(migrated_engine, role, f'SELECT 1 FROM public."{table}" LIMIT 0'), table


@pytest.mark.parametrize("role", SUPABASE_API_ROLES)
def test_api_roles_cannot_call_existing_functions(migrated_engine: Engine, role: str) -> None:
    assert _denied_as(migrated_engine, role, "SELECT public.existing_fn()")


# None = the migrating role itself, i.e. a future migration.
@pytest.mark.parametrize("creator", [None, SUPABASE_ADMIN_ROLE], ids=["migrator", "supabase_admin"])
@pytest.mark.parametrize("role", SUPABASE_API_ROLES)
def test_objects_created_later_are_out_of_reach_of_api_roles(
    migrated_engine: Engine, creator: str | None, role: str
) -> None:
    """A future migration's (or Supabase's) new objects stay private too."""
    with migrated_engine.begin() as conn:
        if creator:
            conn.execute(text(f"SET LOCAL ROLE {creator}"))
        conn.execute(text("CREATE TABLE public.future_table (id serial)"))
        conn.execute(text(
            "CREATE FUNCTION public.future_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'"
        ))
    try:
        assert _denied_as(migrated_engine, role, "SELECT 1 FROM public.future_table LIMIT 0")
        assert _denied_as(migrated_engine, role, "SELECT nextval('public.future_table_id_seq')")
        assert _denied_as(migrated_engine, role, "SELECT public.future_fn()")
    finally:
        with migrated_engine.begin() as conn:
            conn.execute(text("DROP TABLE public.future_table"))
            conn.execute(text("DROP FUNCTION public.future_fn()"))


def test_downgrade_then_upgrade_round_trips(migrated_engine: Engine) -> None:
    # Back to the first lock-down migration by name: "-1" is ambiguous once a
    # merge migration has two parents.
    _alembic("downgrade", "36f77bf75b7b")
    _alembic("upgrade", "head")

    assert "users" in _public_tables(migrated_engine)
    _assert_locked_down(migrated_engine)


def test_refuses_a_database_that_is_not_a_local_test_database() -> None:
    for url in (
        "postgresql://postgres:pw@db.example.supabase.co:5432/postgres_test",
        "postgresql://localhost/tidal",
    ):
        with pytest.raises(pytest.fail.Exception):
            _assert_throwaway_database(url)
    _assert_throwaway_database("postgresql://localhost/tidal_migrations_test")
