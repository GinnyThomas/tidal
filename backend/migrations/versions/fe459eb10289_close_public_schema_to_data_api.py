"""close public schema to data api

Follow-up to 36f77bf75b7b, which enabled RLS and revoked the API roles'
(`anon`, `authenticated`) object privileges. That left three gaps:

  1. its ALTER DEFAULT PRIVILEGES had no FOR ROLE, so it only covered objects
     the migrating role creates — not other creator roles with defaults in
     public (Supabase's `supabase_admin`);
  2. functions in public stayed executable through PUBLIC, which the API
     roles inherit (Postgres grants EXECUTE on new functions to PUBLIC);
  3. the API roles (and PUBLIC) kept USAGE on the schema itself.

This migration revokes the API roles' default privileges for every creator
role we're a member of, revokes EXECUTE on public functions from PUBLIC, and
revokes USAGE on the schema from the API roles and PUBLIC. The last is the
backstop: without USAGE nothing in public is reachable whatever its own
grants say, which covers objects from roles whose defaults we can't change.

The app connects as `postgres`, which owns the tables. It's granted USAGE
explicitly before PUBLIC's is revoked, and the migration fails (rolling back)
if the app would lose access to the schema.

Roles that don't exist (a plain local Postgres) are skipped.

Revision ID: fe459eb10289
Revises: 36f77bf75b7b
Create Date: 2026-10-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'fe459eb10289'
down_revision: Union[str, Sequence[str], None] = '36f77bf75b7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUPABASE_API_ROLES = ("anon", "authenticated")


def upgrade() -> None:
    """Upgrade schema."""
    for role in SUPABASE_API_ROLES:
        # Default privileges belong to the role that creates the objects, so
        # revoke them for ourselves and for every other creator role with
        # defaults in public that we're a member of (on Supabase that excludes
        # supabase_admin — the schema USAGE revoke below covers its objects).
        op.execute(f"""
            DO $$
            DECLARE creator text;
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                    FOR creator IN
                        SELECT current_user::text
                        UNION
                        SELECT pg_get_userbyid(d.defaclrole)::text
                        FROM pg_default_acl d
                        JOIN pg_namespace n ON n.oid = d.defaclnamespace
                        WHERE n.nspname = 'public'
                          AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
                    LOOP
                        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM {role}', creator);
                        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM {role}', creator);
                        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM {role}', creator);
                    END LOOP;
                    REVOKE USAGE ON SCHEMA public FROM {role};
                END IF;
            END $$
        """)

    # Close the schema itself. The app's role gets USAGE in its own right
    # first, in case it only had it through PUBLIC.
    op.execute("""
        DO $$
        BEGIN
            REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
            EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', current_user);
            REVOKE USAGE ON SCHEMA public FROM PUBLIC;
            IF NOT has_schema_privilege(current_user, 'public', 'USAGE') THEN
                RAISE EXCEPTION 'migrating role % would lose USAGE on schema public', current_user;
            END IF;
        END $$
    """)


def downgrade() -> None:
    """Downgrade schema.

    Deliberately a no-op, like 36f77bf75b7b: re-granting the API roles would
    reopen the hole this migration closes.
    """
