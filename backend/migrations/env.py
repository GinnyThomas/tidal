# migrations/env.py
#
# Purpose: Alembic's entry point — runs before every migration command.
#
# Alembic calls this script to find out:
#   1. What the target schema looks like (via target_metadata)
#   2. How to connect to the database (online) or what URL to use (offline)
#
# We customise two things from the Alembic default:
#   - We pull the database URL from our app's settings (not alembic.ini)
#   - We import our models so Alembic can detect schema changes automatically

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# --- Import our app config to get the database URL ---
#
# Why not hardcode the URL in alembic.ini?
# Because we already manage the URL in .env via pydantic-settings.
# Duplicating it would mean two sources of truth that can drift apart.
# Importing settings here keeps a single source of truth.
from app.config import settings

# --- Import Base and all models ---
#
# Base.metadata knows about every table defined in our models.
# But SQLAlchemy only knows about a table once the model's class body
# has been executed — which happens when the module is first imported.
#
# Importing app.models here triggers those imports (see models/__init__.py),
# which registers every model with Base.metadata before Alembic inspects it.
# Without this, --autogenerate would see an empty schema and generate nothing.
from app.database import Base
import app.models  # noqa: F401 — side-effect import: registers all models with Base.metadata

# --- Alembic Config object ---
#
# context.config gives us access to the values in alembic.ini.
# We use it to configure Python's standard logging (fileConfig below)
# and to set the database URL dynamically.
config = context.config

# --- Configure logging from alembic.ini ---
#
# This sets up the loggers defined in the [loggers] section of alembic.ini.
# It's optional but useful — it means Alembic prints INFO-level progress
# messages (e.g. "Running upgrade ...") during migrations.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# --- Point Alembic at our schema ---
#
# target_metadata is what --autogenerate compares the database against.
# By passing Base.metadata, Alembic knows the "desired" state of every
# table we've defined in our models.
target_metadata = Base.metadata

# --- Override the database URL from our app settings ---
#
# We set sqlalchemy.url programmatically here so that alembic.ini
# can safely have an empty string for that key.
# config.set_main_option() writes into the in-memory config object;
# it does not modify alembic.ini on disk.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Offline mode means Alembic generates SQL statements without opening
    a real database connection. The SQL is printed to stdout or written
    to a file. Useful when a DBA needs to review SQL before running it,
    or when the migration environment can't reach the database directly.

    In offline mode we configure the context with a URL only (no Engine).
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,  # render parameter values inline in SQL (e.g. 'GBP' not :param_1)
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    Online mode opens a real database connection and applies the migrations
    directly. This is what `alembic upgrade head` uses in normal development
    and production deploys.

    engine_from_config reads the sqlalchemy.url we set above and creates
    an Engine. We use NullPool here (no connection pooling) because Alembic
    migrations are short-lived processes — pooling would add overhead for
    no benefit, and could leave idle connections open after the migration
    script exits.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


# --- Decide which mode to run ---
#
# Alembic sets context.is_offline_mode() to True when the --sql flag is
# passed on the command line (e.g. `alembic upgrade head --sql`).
# Otherwise we're online.
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
