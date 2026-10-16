# tests/test_config.py
#
# Purpose: Tests for derived settings in app/config.py.
#
# Settings(_env_file=None, ...) builds an isolated instance: no .env file,
# and explicit keyword values win over anything in the environment.

from app.config import Settings


def _settings(**overrides: str) -> Settings:
    return Settings(_env_file=None, DATABASE_URL="sqlite://", SECRET_KEY="test", **overrides)


def test_frontend_base_url_uses_frontend_url_without_trailing_slash() -> None:
    settings = _settings(FRONTEND_URL="https://tidal-vert.vercel.app/")

    assert settings.frontend_base_url == "https://tidal-vert.vercel.app"


def test_frontend_base_url_falls_back_to_first_allowed_origin() -> None:
    """Railway already sets ALLOWED_ORIGINS to the Vercel URL — reuse it."""
    settings = _settings(FRONTEND_URL="", ALLOWED_ORIGINS="https://tidal-vert.vercel.app/, https://staging.example")

    assert settings.frontend_base_url == "https://tidal-vert.vercel.app"


def test_frontend_is_local_for_localhost_and_loopback() -> None:
    assert _settings(FRONTEND_URL="http://localhost:5173").frontend_is_local is True
    assert _settings(FRONTEND_URL="http://127.0.0.1:5173").frontend_is_local is True
    assert _settings(FRONTEND_URL="https://tidal-vert.vercel.app").frontend_is_local is False
