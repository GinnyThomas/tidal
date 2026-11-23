# app/services/bank_feeds/__init__.py
#
# Purpose: FastAPI dependencies that hand routers the configured providers.
#
#   get_bank_feed_provider()   → the consent-flow provider (Enable Banking),
#                                used by the pick-a-bank / redirect endpoints.
#   get_bank_feed_providers()  → every provider THIS user may use, by name.
#                                Sync looks up the one that created a
#                                connection; refresh picks one by name.
#
# BankSync's API key reads one person's banks, so it is offered only to the
# user whose email matches BANKSYNC_OWNER_EMAIL. Everyone else (the public
# demo account included) never sees it.
#
# Tests override both dependencies with fakes, so no test talks to a real bank.

from fastapi import Depends, HTTPException, status

from app.config import settings
from app.models.user import User
from app.services.auth import get_current_user
from app.services.bank_feeds.banksync import BankSyncProvider
from app.services.bank_feeds.enable_banking import EnableBankingProvider
from app.services.bank_feeds.provider import BankFeedProvider, ConsentFlowProvider

# One instance each, so their HTTP connection pools are reused across requests.
_enable_banking: EnableBankingProvider | None = None
_banksync: BankSyncProvider | None = None


def _enable_banking_provider() -> EnableBankingProvider | None:
    global _enable_banking
    if not (settings.ENABLE_BANKING_APPLICATION_ID and settings.ENABLE_BANKING_PRIVATE_KEY):
        return None
    if _enable_banking is None:
        _enable_banking = EnableBankingProvider(
            settings.ENABLE_BANKING_APPLICATION_ID,
            settings.ENABLE_BANKING_PRIVATE_KEY,
        )
    return _enable_banking


def _banksync_provider_for(user: User) -> BankSyncProvider | None:
    global _banksync
    owner = settings.BANKSYNC_OWNER_EMAIL.strip().lower()
    if not (settings.BANKSYNC_API_KEY and owner and user.email.lower() == owner):
        return None
    if _banksync is None:
        _banksync = BankSyncProvider(settings.BANKSYNC_API_KEY)
    return _banksync


def get_bank_feed_provider() -> ConsentFlowProvider:
    """The Enable Banking provider, or 503 when it isn't configured."""
    provider = _enable_banking_provider()
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Bank feeds are not configured on this server.",
        )
    return provider


def get_bank_feed_providers(current_user: User = Depends(get_current_user)) -> dict[str, BankFeedProvider]:
    """Every provider the current user may use, keyed by provider name."""
    providers: list[BankFeedProvider] = [
        p for p in (_enable_banking_provider(), _banksync_provider_for(current_user)) if p is not None
    ]
    return {p.name: p for p in providers}
