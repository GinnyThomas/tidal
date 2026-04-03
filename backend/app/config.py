# app/config.py
#
# Purpose: Central configuration for the Tidal backend.
#
# All environment variables are read here and nowhere else.
# The rest of the codebase imports the `settings` object from this module.
#
# Why pydantic-settings?
# Pydantic v2 split its settings support into a separate package called
# pydantic-settings. BaseSettings works just like a Pydantic model, but it
# knows how to read field values from environment variables and .env files.
# This gives us type validation and clear error messages if anything is missing.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Required fields (no default — app will refuse to start if missing) ---

    # Full PostgreSQL connection string, e.g.:
    # postgresql://user:password@localhost:5432/tidal
    DATABASE_URL: str

    # Random secret used to sign JWT tokens. Must be kept private.
    # Generate one with: python -c "import secrets; print(secrets.token_hex(32))"
    SECRET_KEY: str

    # --- Optional fields with sensible defaults ---

    # JWT signing algorithm. HS256 (HMAC-SHA256) is the industry standard
    # for symmetric JWTs — one secret shared between issuer and verifier.
    ALGORITHM: str = "HS256"

    # How many minutes a JWT access token stays valid before expiry.
    # 30 minutes is a common default — short enough to limit damage if
    # a token is stolen, long enough not to annoy users.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Human-readable application name, used in API responses and docs.
    APP_NAME: str = "Tidal"

    # Comma-separated list of allowed CORS origins.
    # In production, set this to your Vercel frontend URL, e.g.:
    #   ALLOWED_ORIGINS=https://your-app.vercel.app
    # Multiple origins: ALLOWED_ORIGINS=https://app.vercel.app,https://staging.vercel.app
    # The default covers local Vite development on the standard port.
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    # Tell pydantic-settings to look for a .env file in the working directory.
    # extra="ignore" means unknown variables in .env won't cause an error —
    # useful when .env contains vars for other tools (Docker, etc.)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


# Create a single shared instance of Settings.
# This is the "module-level singleton" pattern — Settings() is called once
# when this module is first imported, and every subsequent import reuses
# the same object. Cheap and thread-safe for read-only config.
settings = Settings()
