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
#   DELETE checks is_system and raises 403 if True — system categories
#   cannot be deleted because transactions and budgets reference them.
#   PUT does NOT block system categories — users are allowed to rename them
#   or change their colour/icon to fit their own workflow.
#
# Duplicate name protection:
#   POST and PUT reject a name that already exists (non-deleted) for the same
#   user. This applies to both system and custom categories. The check is
#   case-sensitive, matching how names are stored.
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
        query = query.filter(Category.is_hidden.is_(False))
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

    If parent_category_id is provided, we validate that the parent exists,
    belongs to the current user, and has not been soft-deleted. This prevents
    orphaned child categories and cross-user hierarchy attacks.
    """
    # Reject duplicate names within the same user's category list.
    # This includes both system and custom categories so the list stays clean.
    existing_name = db.query(Category).filter(
        Category.user_id == current_user.id,
        Category.name == category_in.name,
        Category.deleted_at.is_(None),
    ).first()
    if existing_name is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A category with this name already exists.",
        )

    if category_in.parent_category_id is not None:
        _get_category_or_404(category_in.parent_category_id, current_user.id, db)

    category = Category(
        user_id=current_user.id,
        name=category_in.name,
        parent_category_id=category_in.parent_category_id,
        colour=category_in.colour,
        icon=category_in.icon,
        is_hidden=category_in.is_hidden,
        is_income=category_in.is_income,
        group=category_in.group,
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
    Updates a category. Both system and custom categories can be edited.
    System categories can be renamed or have their colour/icon changed to
    suit the user's workflow — only deletion is blocked for system categories.

    Uses exclude_unset=True so only fields the client explicitly sent are
    changed — omitted fields keep their existing values.
    """
    category = _get_category_or_404(category_id, current_user.id, db)

    update_data = category_in.model_dump(exclude_unset=True)

    # Guard against explicitly sending null for non-nullable fields.
    # exclude_unset=True means omitted fields are already absent from this dict,
    # but a client can still send {"name": null} — we reject that here.
    NON_NULLABLE = {"name"}
    for field in NON_NULLABLE:
        if field in update_data and update_data[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{field}' cannot be null.",
            )

    # Reject if the new name collides with another existing category for this user.
    # We exclude the current category from the check so a no-op rename succeeds.
    if "name" in update_data:
        duplicate = db.query(Category).filter(
            Category.user_id == current_user.id,
            Category.name == update_data["name"],
            Category.id != category_id,
            Category.deleted_at.is_(None),
        ).first()
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A category with this name already exists.",
            )

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
