# app/routers/categories.py
#
# Purpose: HTTP endpoints for managing categories.
#
# Endpoints:
#   GET    /api/v1/categories              → flat list of all non-deleted categories (200)
#   POST   /api/v1/categories              → create a custom category (201)
#   PUT    /api/v1/categories/{id}         → update a category (200 or 403/404)
#   DELETE /api/v1/categories/{id}         → soft-delete a category (204 or 403/404)
#
# Security model:
#   All endpoints require a valid JWT via Depends(get_current_user).
#   Every query is scoped to current_user.id — a user can never see or modify
#   another user's categories.
#
# System category protection:
#   PUT and DELETE check is_system and raise 403 if True.
#   Why 403 and not 422 or 400?
#     403 = "Forbidden" — you are authenticated, your request is valid, but
#     you don't have permission for THIS specific action on THIS resource.
#     It's semantically precise: the issue is permission, not data validity.
#
# is_system on create:
#   The POST endpoint never accepts is_system from the client.
#   New categories are always is_system=False — only the seeding service
#   creates is_system=True categories (during registration).

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.category import Category
from app.models.user import User
from app.schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from app.services.auth import get_current_user


router = APIRouter(
    prefix="/api/v1/categories",
    tags=["categories"],
)


# =============================================================================
# Helpers
# =============================================================================


def _get_category_or_404(
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Category:
    """
    Fetch a non-deleted category by ID for a specific user.
    Raises 404 if not found, soft-deleted, or belongs to a different user.
    Same pattern as accounts — 404 instead of 403 to avoid confirming existence.
    """
    category = (
        db.query(Category)
        .filter(
            Category.id == category_id,
            Category.user_id == user_id,
            Category.deleted_at.is_(None),
        )
        .first()
    )
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )
    return category


# =============================================================================
# Endpoints
# =============================================================================


@router.get(
    "",
    response_model=list[CategoryResponse],
)
def list_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_hidden: bool = Query(default=False),
) -> list[Category]:
    """
    Returns all non-deleted categories for the current user as a flat list.

    Includes both system categories (seeded on registration) and any custom
    categories the user has created. The client is responsible for building
    the tree structure from parent_category_id if a nested view is needed.

    include_hidden=false (default): hidden categories are excluded.
    include_hidden=true: all categories are returned regardless of is_hidden.
    """
    query = db.query(Category).filter(
        Category.user_id == current_user.id,
        Category.deleted_at.is_(None),
    )
    if not include_hidden:
        query = query.filter(Category.is_hidden == False)  # noqa: E712
    return query.all()


@router.post(
    "",
    response_model=CategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    category_in: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Category:
    """
    Creates a new custom category owned by the current user.

    is_system is always False for user-created categories — the schema does
    not accept is_system as input and the model defaults it to False.
    """
    category = Category(
        user_id=current_user.id,
        name=category_in.name,
        parent_category_id=category_in.parent_category_id,
        colour=category_in.colour,
        icon=category_in.icon,
        # is_system not set here — model default is False
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.put(
    "/{category_id}",
    response_model=CategoryResponse,
)
def update_category(
    category_id: uuid.UUID,
    category_in: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Category:
    """
    Updates a custom category. System categories cannot be modified.

    Uses exclude_unset=True so only fields the client explicitly sent are
    changed — omitted fields keep their existing values.
    """
    category = _get_category_or_404(category_id, current_user.id, db)

    if category.is_system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System categories cannot be modified.",
        )

    update_data = category_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(category, field, value)

    db.commit()
    db.refresh(category)
    return category


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_category(
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Soft-deletes a custom category by setting deleted_at.

    System categories (is_system=True) cannot be deleted — returns 403.
    This protects any transactions or budgets that reference them.

    Returns 204 No Content on success.
    """
    category = _get_category_or_404(category_id, current_user.id, db)

    if category.is_system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System categories cannot be deleted.",
        )

    category.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.patch(
    "/{category_id}/toggle-visibility",
    response_model=CategoryResponse,
)
def toggle_visibility(
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Category:
    """
    Flips is_hidden on the category and cascades to its direct children.

    If the category is currently visible (is_hidden=False), this hides it and
    all its direct children. If it is already hidden, this unhides it and all
    its direct children.

    Why cascade to children?
      A hidden parent with visible children creates an inconsistent state in
      the UI — subcategories that belong to a hidden parent should also be
      hidden. We cascade one level only (direct children); grandchildren are
      not affected. This keeps the logic simple and predictable.

    System categories CAN be hidden — hiding is less destructive than
    deleting, so we allow it. Only deletion is blocked with 403.
    """
    category = _get_category_or_404(category_id, current_user.id, db)

    new_hidden_value = not category.is_hidden

    # Update the category itself
    category.is_hidden = new_hidden_value

    # Cascade to direct children (same user, not deleted)
    children = (
        db.query(Category)
        .filter(
            Category.user_id == current_user.id,
            Category.parent_category_id == category_id,
            Category.deleted_at.is_(None),
        )
        .all()
    )
    for child in children:
        child.is_hidden = new_hidden_value

    db.commit()
    db.refresh(category)
    return category
