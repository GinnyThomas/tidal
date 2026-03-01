# tests/conftest.py
#
# Purpose: pytest configuration and shared fixtures for all tests.
#
# conftest.py is special — pytest loads it automatically before collecting
# or running any tests. Fixtures and setup defined here are available to
# every test in this directory and its subdirectories without needing to
# import them.
#
# IMPORTANT: Environment variables must be set at the very top of this file,
# before any `from app import ...` statements. Why? Because importing
# app.config triggers Settings(), which reads env vars immediately.
# If the vars aren't set yet, pydantic-settings raises a validation error.

import os

# Set required environment variables for the test environment.
# These are fake values — safe for testing, not for production.
# os.environ.setdefault only sets the variable if it isn't already set,
# so a real .env file takes precedence if present.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://test_user:test_password@localhost:5432/tidal_test",
)
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")

# --- Fixtures will be added here as the project grows ---
#
# Upcoming fixtures will include:
#   - A test database session (using a separate test DB, not production)
#   - An authenticated test client (with a valid JWT in headers)
#   - Factory-boy factories for creating test data (User, Account, etc.)
