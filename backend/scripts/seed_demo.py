#!/usr/bin/env python3
# scripts/seed_demo.py
#
# Purpose: Creates an idempotent demo account for the Tidal app.
#
# Usage (run from the backend/ directory):
#   python scripts/seed_demo.py
#
# What it creates:
#   - Demo user: demo@tidal.app / TidalDemo2026!
#   - Default system categories (same 35 categories every user gets)
#   - 2 accounts: Current Account (GBP) and Savings Account (GBP)
#   - 8 realistic recurring schedules covering common household bills
#
# Idempotent: safe to run multiple times. Each section checks whether the
# records already exist before inserting — running twice creates no duplicates.
#
# Why a separate script rather than a fixture or migration?
#   This is one-off operational data, not schema. It runs on demand when
#   setting up a demo environment (local or production). Migrations run on
#   every deploy; seeding demo data every deploy would pollute production.

import os
import sys
from datetime import date
from decimal import Decimal

# Allow `from app...` imports when running as `python scripts/seed_demo.py`
# from the backend/ directory. Without this, Python can't find the `app` package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.account import Account
from app.models.category import Category
from app.models.schedule import Schedule
from app.models.user import User
from app.services.auth import hash_password
from app.services.categories import seed_default_categories

DEMO_EMAIL = "demo@tidal.app"
DEMO_PASSWORD = "TidalDemo2026!"


def seed_demo() -> None:
    db = SessionLocal()
    try:
        # ── Step 1: Demo user ───────────────────────────────────────────────
        # Check by email — idempotent, only creates if not present.
        user = db.query(User).filter(User.email == DEMO_EMAIL).first()
        if user is None:
            user = User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
            )
            db.add(user)
            db.flush()   # get the auto-generated UUID before commit
            db.refresh(user)
            seed_default_categories(user.id, db)
            db.commit()
            print(f"✓ Created demo user: {DEMO_EMAIL}")
        else:
            # Always reset password so the demo button works even if someone
            # changed it via the Change Password page.
            user.password_hash = hash_password(DEMO_PASSWORD)
            db.add(user)
            db.commit()
            print(f"  Demo user already exists: {DEMO_EMAIL} (password reset to demo default)")

        # ── Step 2: Accounts ────────────────────────────────────────────────
        existing_accounts = (
            db.query(Account)
            .filter(Account.user_id == user.id, Account.deleted_at.is_(None))
            .all()
        )
        existing_account_names = {a.name for a in existing_accounts}

        new_accounts = [
            Account(
                user_id=user.id,
                name="Current Account",
                account_type="checking",
                currency="GBP",
                current_balance=Decimal("1500.00"),
                institution="Nationwide",
            ),
            Account(
                user_id=user.id,
                name="Savings Account",
                account_type="savings",
                currency="GBP",
                current_balance=Decimal("5000.00"),
                institution="Nationwide",
            ),
        ]

        for acct in new_accounts:
            if acct.name not in existing_account_names:
                db.add(acct)
                print(f"✓ Created account: {acct.name}")
            else:
                print(f"  Account already exists: {acct.name}")

        db.flush()  # get IDs for newly inserted accounts

        # Reload all accounts to build a name → id map
        all_accounts = (
            db.query(Account)
            .filter(Account.user_id == user.id, Account.deleted_at.is_(None))
            .all()
        )
        account_map = {a.name: a.id for a in all_accounts}
        current_id = account_map.get("Current Account")
        savings_id = account_map.get("Savings Account")

        # ── Step 3: Category lookup ─────────────────────────────────────────
        # Fetch the seeded categories so we can reference them in schedules.
        categories = (
            db.query(Category)
            .filter(Category.user_id == user.id, Category.deleted_at.is_(None))
            .all()
        )
        cat_map = {c.name: c.id for c in categories}

        # If cat_map is empty (e.g. user existed but categories were never seeded
        # or were removed), seed them now and rebuild the map.
        if not cat_map:
            print("  No categories found — seeding default categories...")
            seed_default_categories(user.id, db)
            db.commit()
            categories = (
                db.query(Category)
                .filter(Category.user_id == user.id, Category.deleted_at.is_(None))
                .all()
            )
            cat_map = {c.name: c.id for c in categories}

        # Raise a clear error if categories are still missing after seeding.
        # This should never happen — seed_default_categories creates 35 categories.
        if not cat_map:
            raise RuntimeError(
                "Failed to seed default categories for demo user. "
                "Check seed_default_categories() in app/services/categories.py."
            )

        # Helper: find a category by name, falling back to the first available.
        # The fallback is defensive — the names below should always be present
        # in the default set, but this prevents a KeyError if the seed list changes.
        def cat(name: str):
            result = cat_map.get(name)
            if result is None:
                fallback = next(iter(cat_map.values()))
                print(f"  Warning: category '{name}' not found — using fallback")
                return fallback
            return result

        # ── Step 4: Schedules ───────────────────────────────────────────────
        existing_schedules = (
            db.query(Schedule)
            .filter(Schedule.user_id == user.id, Schedule.deleted_at.is_(None))
            .all()
        )
        existing_schedule_names = {s.name for s in existing_schedules}

        # 8 realistic monthly schedules. Uses sub-categories where available
        # (e.g. "Rent/Mortgage" is a child of "Household", "Streaming" of "Entertainment").
        new_schedules = [
            Schedule(
                user_id=user.id,
                account_id=current_id,
                category_id=cat("Rent/Mortgage"),
                name="Monthly Rent",
                payee="Landlord",
                amount=Decimal("950.00"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=1,
                start_date=date(2026, 1, 1),
                auto_generate=True,
                active=True,
            ),
            Schedule(
                user_id=user.id,
                account_id=current_id,
                category_id=cat("Utilities"),
                name="Electricity Bill",
                payee="British Gas",
                amount=Decimal("75.00"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=15,
                start_date=date(2026, 1, 1),
                auto_generate=True,
                active=True,
            ),
            Schedule(
                user_id=user.id,
                account_id=current_id,
                category_id=cat("Phone & Internet"),
                name="Broadband",
                payee="BT",
                amount=Decimal("45.00"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=20,
                start_date=date(2026, 1, 1),
                auto_generate=True,
                active=True,
            ),
            Schedule(
                user_id=user.id,
                account_id=current_id,
                category_id=cat("Streaming"),
                name="Netflix",
                payee="Netflix",
                amount=Decimal("15.99"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=8,
                start_date=date(2026, 1, 1),
                auto_generate=True,
                active=True,
            ),
            Schedule(
                user_id=user.id,
                account_id=current_id,
                category_id=cat("Streaming"),
                name="Spotify",
                payee="Spotify",
                amount=Decimal("9.99"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=12,
                start_date=date(2026, 1, 1),
                auto_generate=True,
                active=True,
            ),
            Schedule(
                user_id=user.id,
                account_id=current_id,
                category_id=cat("Fitness"),
                name="Gym Membership",
                payee="Pure Gym",
                amount=Decimal("25.00"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=1,
                start_date=date(2026, 1, 1),
                auto_generate=True,
                active=True,
            ),
            Schedule(
                user_id=user.id,
                account_id=current_id,
                category_id=cat("Salary"),
                name="Salary",
                payee="Employer",
                amount=Decimal("2500.00"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=28,
                start_date=date(2026, 1, 1),
                auto_generate=True,
                active=True,
            ),
            Schedule(
                user_id=user.id,
                # Savings transfer goes to the savings account
                account_id=savings_id if savings_id else current_id,
                category_id=cat("Savings"),
                name="Monthly Savings Transfer",
                payee="Nationwide Savings",
                amount=Decimal("300.00"),
                currency="GBP",
                frequency="monthly",
                interval=1,
                day_of_month=28,
                start_date=date(2026, 1, 1),
                # auto_generate=False: this is a reminder, not an auto-transaction.
                # The user manually confirms each transfer.
                auto_generate=False,
                active=True,
            ),
        ]

        for sched in new_schedules:
            if sched.name not in existing_schedule_names:
                db.add(sched)
                print(f"✓ Created schedule: {sched.name}")
            else:
                print(f"  Schedule already exists: {sched.name}")

        db.commit()
        print("\nDemo seed complete.")

    except Exception as e:
        db.rollback()
        print(f"Error during seeding: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo()
