# app/routers/opening_balances.py

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.opening_balance import GroupOpeningBalance
from app.models.user import User
from app.schemas.opening_balance import (
    OpeningBalanceCreate,
    OpeningBalanceResponse,
    OpeningBalanceUpdate,
)
from app.services.auth import get_current_user

router = APIRouter(
    prefix="/api/v1/opening-balances",
    tags=["opening-balances"],
)


def _get_or_404(ob_id: uuid.UUID, user_id: uuid.UUID, db: Session) -> GroupOpeningBalance:
    ob = db.query(GroupOpeningBalance).filter(
        GroupOpeningBalance.id == ob_id, GroupOpeningBalance.user_id == user_id,
    ).first()
    if ob is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opening balance not found")
    return ob


@router.post("", status_code=status.HTTP_201_CREATED, response_model=OpeningBalanceResponse)
def create_opening_balance(
    data: OpeningBalanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GroupOpeningBalance:
    existing = db.query(GroupOpeningBalance).filter(
        GroupOpeningBalance.user_id == current_user.id,
        GroupOpeningBalance.group == data.group,
        GroupOpeningBalance.year == data.year,
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Opening balance already exists for this group and year")

    ob = GroupOpeningBalance(
        user_id=current_user.id,
        group=data.group,
        year=data.year,
        opening_balance=data.opening_balance,
        currency=data.currency,
    )
    db.add(ob)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Opening balance already exists for this group and year",
        )
    db.refresh(ob)
    return ob


@router.get("", response_model=list[OpeningBalanceResponse])
def list_opening_balances(
    year: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[GroupOpeningBalance]:
    query = db.query(GroupOpeningBalance).filter(GroupOpeningBalance.user_id == current_user.id)
    if year is not None:
        query = query.filter(GroupOpeningBalance.year == year)
    return query.all()


@router.put("/{ob_id}", response_model=OpeningBalanceResponse)
def update_opening_balance(
    ob_id: uuid.UUID,
    data: OpeningBalanceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GroupOpeningBalance:
    ob = _get_or_404(ob_id, current_user.id, db)
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if value is not None:
            setattr(ob, field, value)
    db.commit()
    db.refresh(ob)
    return ob


@router.delete("/{ob_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_opening_balance(
    ob_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    ob = _get_or_404(ob_id, current_user.id, db)
    db.delete(ob)
    db.commit()
