# app/logging_config.py
#
# Purpose: Make the app's own loggers (`app.*`) actually print INFO messages.
#
# Why is this needed?
#   uvicorn configures logging only for its own loggers (uvicorn, uvicorn.access,
#   uvicorn.error). A logger like `app.services.email` has no handler, so Python
#   falls back to its "last resort" handler, which prints WARNING and above only.
#   Every logger.info(...) in the app was silently dropped — including the
#   local-dev reset link and the "email sent" / "no account" lines that tell
#   you which forgot-password outcome happened.
#
# We attach one stderr handler to the `app` logger (Railway captures stderr).
# The format mirrors uvicorn's "INFO:     ..." so log lines look consistent.

import logging
import sys

APP_LOGGER_NAME = "app"
HANDLER_NAME = "tidal-app-stderr"


def configure_logging() -> None:
    """Sends `app.*` logs at INFO and above to stderr. Safe to call more than once."""
    logger = logging.getLogger(APP_LOGGER_NAME)
    logger.setLevel(logging.INFO)

    # Replace (rather than add to) our handler, so repeated calls — e.g. module
    # re-imports under `uvicorn --reload` — never print each line twice.
    for handler in list(logger.handlers):
        if handler.get_name() == HANDLER_NAME:
            logger.removeHandler(handler)

    handler = logging.StreamHandler(sys.stderr)
    handler.set_name(HANDLER_NAME)
    handler.setFormatter(logging.Formatter("%(levelname)s:     [%(name)s] %(message)s"))
    logger.addHandler(handler)
