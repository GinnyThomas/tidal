# app/services/categories.py
#
# Purpose: Business logic for categories — specifically seeding the default
#          system categories that every new user gets on registration.
#
# Why seed categories at registration?
#   Starting with zero categories is a bad user experience. New users would
#   have to manually create every category before they could log a transaction.
#   Seeding provides a sensible starting point covering the most common
#   spending areas. Users can then add custom categories on top.
#
# Why is_system=True?
#   System categories cannot be deleted by the user. They are the foundation
#   that budgets, schedules, and transactions can safely reference. If a user
#   could delete "Food & Drink", any transactions tagged to it would reference
#   a missing category. is_system=True is the protection against that.
#
# How parent IDs work here:
#   SQLAlchemy's `default=uuid.uuid4` is a PYTHON-SIDE default — it assigns
#   the UUID to the object's `.id` attribute when Category(...) is called,
#   before the object is added to the session or flushed. This means we can
#   create a parent Category object and immediately use parent.id as a child's
#   parent_category_id, all in memory, with no database round-trip needed.
#   We then add everything in one batch and commit once.

import uuid

from sqlalchemy.orm import Session

from app.models.category import Category


def seed_default_categories(user_id: uuid.UUID, db: Session) -> None:
    """
    Creates the standard set of system categories for a newly registered user.

    Parents are created before their children so that parent.id is available
    when constructing child Category objects. All objects are added to the
    session and committed in a single batch at the end.

    Called by the register endpoint. Does NOT commit — the caller is responsible
    for the final commit so that user creation and seeding live in one transaction.
    If seeding fails, the whole registration rolls back (no orphaned user rows).
    """

    # --- Helper: build a Category object (not yet added to the session) ---
    def cat(
        name: str,
        parent_category_id: uuid.UUID | None = None,
    ) -> Category:
        return Category(
            user_id=user_id,
            name=name,
            is_system=True,
            parent_category_id=parent_category_id,
        )

    # ------------------------------------------------------------------
    # Build all category objects in memory.
    # Parents first — their .id is ready to use as soon as they're created.
    # ------------------------------------------------------------------

    food = cat("Food & Drink")
    household = cat("Household")
    transport = cat("Transport")
    entertainment = cat("Entertainment")
    health = cat("Health")
    personal = cat("Personal")
    phone = cat("Phone & Internet")
    banking = cat("Banking & Finance")
    education = cat("Education")
    savings = cat("Savings")
    gifts = cat("Gifts & Celebrations")
    travel = cat("Travel")
    income = cat("Income")

    all_categories = [
        # Top-level parents
        food, household, transport, entertainment, health,
        personal, phone, banking, education, savings, gifts, travel, income,

        # Food & Drink children
        cat("Groceries",        food.id),
        cat("Eating Out",       food.id),
        cat("Takeaway",         food.id),

        # Household children
        cat("Rent/Mortgage",    household.id),
        cat("Utilities",        household.id),
        cat("Insurance",        household.id),

        # Transport children
        cat("Car",              transport.id),
        cat("Public Transport", transport.id),
        cat("Parking",          transport.id),
        cat("Fuel",             transport.id),

        # Entertainment children
        cat("Streaming",        entertainment.id),
        cat("Sports",           entertainment.id),
        cat("Gaming",           entertainment.id),

        # Health children
        cat("Medical",          health.id),
        cat("Fitness",          health.id),

        # Personal children
        cat("Clothing",         personal.id),
        cat("Hair & Beauty",    personal.id),

        # Banking & Finance children
        cat("Bank Fees",        banking.id),
        cat("Debt Payments",    banking.id),

        # Income children
        cat("Salary",           income.id),
        cat("Freelance",        income.id),
        cat("Reimbursements",   income.id),
    ]

    db.add_all(all_categories)
