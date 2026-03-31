# app/models/category.py
#
# Purpose: SQLAlchemy model for the categories table.
#
# Categories are hierarchical. A category can have a parent (e.g. "Groceries"
# lives under "Food & Drink"). The self-referential foreign key
# parent_category_id → categories.id implements this tree in a single table.
# This pattern is called an "Adjacency List" — each row knows only its direct
# parent, not the full path. Simple to query, easy to understand.
#
# System categories (is_system=True) are seeded automatically when a user
# registers and cannot be deleted by the user. They provide sensible defaults
# without requiring manual setup. Custom categories (is_system=False) are
# created freely and can be deleted.
#
# Design decisions:
#   - Self-referential FK: ForeignKey("categories.id"). No ORM relationship
#     defined here — we don't need eager loading in this phase; the flat list
#     endpoint returns all categories and the client builds the tree.
#   - is_system enforced at the service layer (router raises 403 on delete).
#     We don't use a DB-level constraint because that would complicate tests.
#   - Soft delete follows the same pattern as User and Account.

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Category(Base):
    """Represents a spending/income category belonging to a user."""

    __tablename__ = "categories"

    # --- Primary key ---
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # --- Ownership ---
    # Every category belongs to exactly one user. System and custom categories
    # are both user-scoped — seeding creates one set per user.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    # --- Identity ---
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # --- Hierarchy ---
    #
    # Self-referential FK: points at another row in THIS table.
    # None = top-level category. A UUID = child category.
    # ForeignKey("categories.id") is defined AFTER the primary key above,
    # so SQLAlchemy knows about the target column when processing this.
    #
    # SQLite FK enforcement note:
    #   SQLite does NOT enforce foreign key constraints unless you explicitly
    #   run `PRAGMA foreign_keys = ON` per connection. Our test suite uses
    #   SQLite without that PRAGMA, so FK violations are silently ignored —
    #   this is intentional and keeps tests simple. In production, PostgreSQL
    #   enforces all FK constraints unconditionally.
    parent_category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id"),
        nullable=True,
    )

    # --- Display ---
    # Optional hex colour code e.g. "#FF5733". Max 7 chars covers "#RRGGBB".
    colour: Mapped[str | None] = mapped_column(String(7), nullable=True)

    # Optional icon identifier (e.g. an icon name from a design system).
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # --- Classification ---
    #
    # is_system=True: seeded automatically on registration, cannot be deleted.
    # is_system=False: created by the user, can be freely deleted.
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # --- Visibility ---
    #
    # is_hidden=True: category is hidden from the default list view.
    # Users can hide categories they don't use without deleting them.
    # The list endpoint filters these out unless include_hidden=true is passed.
    # Toggling a parent's visibility cascades to its direct children.
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # --- Timestamps ---
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # --- Soft delete ---
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    def __repr__(self) -> str:
        parent = f" parent={self.parent_category_id}" if self.parent_category_id else ""
        return f"<Category id={self.id} name={self.name!r}{parent}>"
