# migrations/env.py
#
# Purpose: Alembic's entry point — runs before every migration command.
#
# Alembic calls this script to find out:
#   1. What the target schema looks like (via target_metadata)
#   2. How to connect to the database (online) or what URL to use (offline)
#
# We customise two things from the Alembic default:
#   - We read DATABASE_URL directly from the environment (not via app.config.settings)
#   - We import Base and models lazily inside run_migrations_online() so Alembic
#     only loads app code when it actually needs to run migrations

import os
from logging.config import fileConfig

from dotenv import load_dotenv

# Load .env so DATABASE_URL is available via os.getenv.
# pydantic-settings did this automatically when we imported app.config.settings;
# now that we read the URL directly we have to do it ourselves.
load_dotenv()

from alembic import context
from sqlalchemy import engine_from_config, pool

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

# --- Read the database URL from the environment ---
#
# We read DATABASE_URL directly from os.getenv rather than importing
# app.config.settings. Why? Because Settings is a pydantic model that
# validates ALL required fields on instantiation — including SECRET_KEY.
# In environments that only have DATABASE_URL (e.g. a CI step that only
# runs migrations), importing settings would crash before Alembic even
# connects. Reading from os.getenv avoids that entirely.
#
# The `or` fallback allows overriding via alembic.ini in a pinch,
# but in normal use DATABASE_URL from .env (loaded by python-dotenv or
# the shell) is the single source of truth.
db_url = os.getenv("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
config.set_main_option("sqlalchemy.url", db_url)

# --- target_metadata placeholder ---
#
# Set to None here; overridden inside run_migrations_online() after the
# lazy model imports. run_migrations_offline() also sets it locally.
target_metadata = None


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
    # --- Lazy imports of Base and models ---
    #
    # We import here rather than at the top of the file so that app code
    # (SQLAlchemy, psycopg2, all model files) is only loaded when Alembic
    # actually needs to connect and run migrations. Commands like
    # `alembic history` or `alembic current` never call this function and
    # therefore never pay the import cost.
    #
    # app.models is a side-effect import: importing it causes every model
    # class to register itself with Base.metadata (see models/__init__.py).
    # Without this, --autogenerate would see an empty schema.
    from app.database import Base
    import app.models  # noqa: F401 — registers all models with Base.metadata

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=Base.metadata,
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
