# app/routers/promotions.py
#
# Purpose: API endpoints for managing interest promotions.
#
# Endpoints:
#   POST   /api/v1/promotions       — create (201)
#   GET    /api/v1/promotions       — list, optional ?active_only=true
#   GET    /api/v1/promotions/{id}  — single with computed fields
#   PUT    /api/v1/promotions/{id}  — update
#   DELETE /api/v1/promotions/{id}  — hard delete

import math
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.promotion import Promotion
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.promotion import (
    PromotionCreate,
    PromotionResponse,
    PromotionUpdate,
)
from app.services.auth import get_current_user

router = APIRouter(
    prefix="/api/v1/promotions",
    tags=["promotions"],
)


# =============================================================================
# Helpers
# =============================================================================


def _get_promotion_or_404(
    promotion_id: uuid.UUID, user_id: uuid.UUID, db: Session,
) -> Promotion:
    promotion = (
        db.query(Promotion)
        .filter(Promotion.id == promotion_id, Promotion.user_id == user_id)
        .first()
    )
    if promotion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found",
        )
    return promotion


def _compute_fields(promotion: Promotion, db: Session) -> dict:
    """Compute the derived fields for a PromotionResponse."""
    today = date.today()
    days_remaining = (promotion.end_date - today).days

    # Total paid: sum of cleared + reconciled transactions linked to this promotion
    total_paid_result = (
        db.query(Transaction)
        .filter(
            Transaction.promotion_id == promotion.id,
            Transaction.deleted_at.is_(None),
            Transaction.status.in_(["cleared", "reconciled"]),
        )
        .all()
    )
    total_paid = sum((t.amount for t in total_paid_result), Decimal("0"))
    remaining_balance = promotion.original_balance - total_paid

    # Required monthly payment to clear by end_date
    required_monthly_payment: Decimal | None = None
    if days_remaining > 0 and remaining_balance > 0:
        months_remaining = max(days_remaining / 30.44, 1)  # avg days per month
        required_monthly_payment = (remaining_balance / Decimal(str(months_remaining))).quantize(Decimal("0.01"))

    # Urgency level
    if days_remaining < 0:
        urgency = "expired"
    elif days_remaining <= 5:
        urgency = "critical"
    elif days_remaining <= 30:
        urgency = "warning"
    elif days_remaining <= 60:
        urgency = "caution"
    else:
        urgency = "ok"

    return {
        "days_remaining": days_remaining,
        "required_monthly_payment": required_monthly_payment,
        "total_paid": total_paid,
        "remaining_balance": remaining_balance,
        "urgency": urgency,
    }


def _to_response(promotion: Promotion, db: Session) -> dict:
    """Build the full response dict including computed fields."""
    data = {
        "id": promotion.id,
        "user_id": promotion.user_id,
        "account_id": promotion.account_id,
        "name": promotion.name,
        "promotion_type": promotion.promotion_type,
        "original_balance": promotion.original_balance,
        "interest_rate": promotion.interest_rate,
        "start_date": promotion.start_date,
        "end_date": promotion.end_date,
        "minimum_monthly_payment": promotion.minimum_monthly_payment,
        "is_active": promotion.is_active,
        "notes": promotion.notes,
        "created_at": promotion.created_at,
        "updated_at": promotion.updated_at,
    }
    data.update(_compute_fields(promotion, db))
    return data


# =============================================================================
# Endpoints
# =============================================================================


@router.post("", status_code=status.HTTP_201_CREATED, response_model=PromotionResponse)
def create_promotion(
    data: PromotionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    promotion = Promotion(
        user_id=current_user.id,
        account_id=data.account_id,
        name=data.name,
        promotion_type=data.promotion_type,
        original_balance=data.original_balance,
        interest_rate=data.interest_rate,
        start_date=data.start_date,
        end_date=data.end_date,
        minimum_monthly_payment=data.minimum_monthly_payment,
        is_active=data.is_active,
        notes=data.notes,
    )
    db.add(promotion)
    db.commit()
    db.refresh(promotion)
    return _to_response(promotion, db)


@router.get("", response_model=list[PromotionResponse])
def list_promotions(
    active_only: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    query = db.query(Promotion).filter(Promotion.user_id == current_user.id)
    if active_only:
        query = query.filter(Promotion.is_active.is_(True))
    promotions = query.order_by(Promotion.end_date).all()
    return [_to_response(p, db) for p in promotions]


@router.get("/{promotion_id}", response_model=PromotionResponse)
def get_promotion(
    promotion_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    promotion = _get_promotion_or_404(promotion_id, current_user.id, db)
    return _to_response(promotion, db)


@router.put("/{promotion_id}", response_model=PromotionResponse)
def update_promotion(
    promotion_id: uuid.UUID,
    data: PromotionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    promotion = _get_promotion_or_404(promotion_id, current_user.id, db)
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(promotion, field, value)
    db.commit()
    db.refresh(promotion)
    return _to_response(promotion, db)


@router.delete("/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_promotion(
    promotion_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    promotion = _get_promotion_or_404(promotion_id, current_user.id, db)
    db.delete(promotion)
    db.commit()
