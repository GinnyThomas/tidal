# tests/test_logging_config.py
#
# Purpose: The app's own loggers must actually print INFO messages.
#
# uvicorn only configures its own loggers. Without app/logging_config.py,
# an `app.*` logger falls back to Python's last-resort handler, which shows
# WARNING and above only — so INFO lines (e.g. the local-dev reset link)
# silently vanished.

import logging

from app.logging_config import configure_logging


def test_app_loggers_emit_info(capfd) -> None:
    configure_logging()

    logging.getLogger("app.services.email").info("info-line-visible")

    assert "info-line-visible" in capfd.readouterr().err


def test_configure_logging_is_idempotent(capfd) -> None:
    """Calling it twice (e.g. uvicorn --reload re-imports) must not duplicate lines."""
    configure_logging()
    configure_logging()

    logging.getLogger("app.services.email").info("printed-once")

    assert capfd.readouterr().err.count("printed-once") == 1
