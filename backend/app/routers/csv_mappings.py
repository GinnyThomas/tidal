# app/routers/csv_mappings.py
#
# Purpose: Endpoints for saving and retrieving per-account CSV column mappings.
#
# Endpoints:
#   GET  /api/v1/csv-mappings/{account_id} — returns saved mapping or 404
#   POST /api/v1/csv-mappings              — upserts mapping for an account

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.account import Account
from app.models.csv_mapping import CsvMapping
from app.schemas.csv_mapping import CsvMappingCreate, CsvMappingResponse
from app.services.auth import get_current_user
from app.models.user import User


router = APIRouter(
    prefix="/api/v1/csv-mappings",
    tags=["csv-mappings"],
)


def _get_account_or_404(
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Account:
    account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.user_id == user_id,
            Account.deleted_at.is_(None),
        )
        .first()
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )
    return account


@router.get(
    "/{account_id}",
    response_model=CsvMappingResponse,
)
def get_csv_mapping(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CsvMapping:
    """Returns the saved CSV mapping for the given account, or 404."""
    _get_account_or_404(account_id, current_user.id, db)

    mapping = (
        db.query(CsvMapping)
        .filter(
            CsvMapping.account_id == account_id,
            CsvMapping.user_id == current_user.id,
        )
        .first()
    )
    if mapping is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No saved mapping for this account.",
        )
    return mapping


@router.post(
    "",
    response_model=CsvMappingResponse,
    status_code=status.HTTP_200_OK,
)
def upsert_csv_mapping(
    mapping_in: CsvMappingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CsvMapping:
    """Saves or updates the CSV mapping for an account.

    If a mapping already exists for (user, account), it is updated in-place.
    Otherwise a new row is created.
    Returns the saved mapping.
    """
    _get_account_or_404(mapping_in.account_id, current_user.id, db)

    existing = (
        db.query(CsvMapping)
        .filter(
            CsvMapping.account_id == mapping_in.account_id,
            CsvMapping.user_id == current_user.id,
        )
        .first()
    )

    if existing:
        existing.name = mapping_in.name
        existing.mapping_json = mapping_in.mapping_json
        db.commit()
        db.refresh(existing)
        return existing

    new_mapping = CsvMapping(
        user_id=current_user.id,
        account_id=mapping_in.account_id,
        name=mapping_in.name,
        mapping_json=mapping_in.mapping_json,
    )
    db.add(new_mapping)
    db.commit()
    db.refresh(new_mapping)
    return new_mapping
