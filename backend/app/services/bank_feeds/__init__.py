# app/services/bank_feeds/__init__.py
#
# Purpose: FastAPI dependency that hands routers the configured provider.
#
# Tests override get_bank_feed_provider with a fake, so no test ever talks
# to a real bank.

from fastapi import HTTPException, status

from app.config import settings
from app.services.bank_feeds.enable_banking import EnableBankingProvider
from app.services.bank_feeds.provider import BankFeedProvider

_provider: EnableBankingProvider | None = None


def get_bank_feed_provider() -> BankFeedProvider:
    """The Enable Banking provider, or 503 when it isn't configured."""
    global _provider
    if not (settings.ENABLE_BANKING_APPLICATION_ID and settings.ENABLE_BANKING_PRIVATE_KEY):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Bank feeds are not configured on this server.",
        )
    # One instance, so its HTTP connection pool is reused across requests.
    if _provider is None:
        _provider = EnableBankingProvider(
            settings.ENABLE_BANKING_APPLICATION_ID,
            settings.ENABLE_BANKING_PRIVATE_KEY,
        )
    return _provider
