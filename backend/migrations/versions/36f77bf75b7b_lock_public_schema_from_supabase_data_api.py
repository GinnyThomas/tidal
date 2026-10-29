"""lock public schema from supabase data api

Supabase serves the "public" schema over its Data API (PostgREST /
supabase-js) as the `anon` and `authenticated` roles. Tidal never uses that
API — the frontend only talks to FastAPI — but with no Row-Level Security,
anyone holding the project's anon key could read and edit every table
(Supabase advisor: rls_disabled_in_public).

This migration:
  1. enables RLS on every public table, with no policies — deny-all for any
     role that doesn't own the table or have BYPASSRLS;
  2. revokes all table/sequence/function privileges from the API roles;
  3. revokes the default privileges, so tables created by later migrations
     are never granted to them either.

The app connects as `postgres`, which owns the tables, so RLS doesn't
restrict it and nothing changes for the backend.

Roles that don't exist (a plain local Postgres) are skipped.

Revision ID: 36f77bf75b7b
Revises: c9d3e5a7b1f2
Create Date: 2026-10-25 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '36f77bf75b7b'
down_revision: Union[str, Sequence[str], None] = 'c9d3e5a7b1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUPABASE_API_ROLES = ("anon", "authenticated")


def upgrade() -> None:
    """Upgrade schema."""
    # Every table, including alembic_version — read from the catalogue so no
    # table can be missed. Quoted with %I in case a name is a reserved word.
    op.execute("""
        DO $$
        DECLARE t text;
        BEGIN
            FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            END LOOP;
        END $$
    """)

    for role in SUPABASE_API_ROLES:
        op.execute(f"""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role};
                    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role};
                    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM {role};
                    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM {role};
                    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM {role};
                    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM {role};
                END IF;
            END $$
        """)


def downgrade() -> None:
    """Downgrade schema.

    Deliberately a no-op: re-granting the API roles would reopen the hole this
    migration closes, and RLS without policies doesn't affect the app.
    """
