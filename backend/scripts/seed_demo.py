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
#   - 3 accounts: Nationwide Current (GBP), Nationwide Savings (GBP),
#                 Santander España (EUR)
#   - 14 schedules: monthly GBP bills, monthly EUR bills, annual and quarterly
#   - Rolling transactions: 3 months back from today + current month
#     (cleared for past months, mix of cleared/pending for current month)
#
# Multi-currency demo:
#   The EUR Santander account receives a monthly EUR freelance salary and
#   pays EUR expenses (rent, groceries, eating out). This demonstrates
#   multi-currency transactions appearing in the same category (e.g.
#   Groceries in both GBP and EUR), which surfaces the currency consolidation
#   question naturally when reviewing budgets.
#
# Idempotent: safe to run multiple times. Each section checks whether the
# records already exist before inserting — running twice creates no duplicates.
#
# To refresh demo data on production:
#   DATABASE_URL="postgresql://postgres:PASSWORD@db.msframaqmymeunoqmtjr.supabase.co:5432/postgres" python scripts/seed_demo.py

import os
import sys
import calendar
from datetime import date, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.account import Account
from app.models.budget import Budget, BudgetOverride
from app.models.category import Category
from app.models.promotion import Promotion
from app.models.schedule import Schedule
from app.models.transaction import Transaction
from app.models.user import User
from app.services.auth import hash_password
from app.services.categories import seed_default_categories

DEMO_EMAIL = "demo@tidal.app"
DEMO_PASSWORD = "TidalDemo2026!"


def _months_back(months: int) -> date:
    """Return the 1st of the month N months before today."""
    today = date.today()
    month = today.month - months
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


def _date_in_month(month_start: date, day: int) -> date:
    """Return a date in the given month, clamped to the last day of the month."""
    last_day = calendar.monthrange(month_start.year, month_start.month)[1]
    return date(month_start.year, month_start.month, min(day, last_day))


def seed_demo() -> None:
    db = SessionLocal()
    try:
        today = date.today()

        # ── Step 1: Demo user ───────────────────────────────────────────────
        user = db.query(User).filter(User.email == DEMO_EMAIL).first()
        if user is None:
            user = User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
            )
            db.add(user)
            db.flush()
            db.refresh(user)
            seed_default_categories(user.id, db)
            db.commit()
            print(f"✓ Created demo user: {DEMO_EMAIL}")
        else:
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
                user_id=user.id, name="Current Account",
                account_type="checking", currency="GBP",
                current_balance=Decimal("1500.00"), institution="Nationwide",
            ),
            Account(
                user_id=user.id, name="Savings Account",
                account_type="savings", currency="GBP",
                current_balance=Decimal("5000.00"), institution="Nationwide",
            ),
            Account(
                user_id=user.id, name="Santander España",
                account_type="checking", currency="EUR",
                current_balance=Decimal("2200.00"), institution="Santander",
            ),
        ]

        for acct in new_accounts:
            if acct.name not in existing_account_names:
                db.add(acct)
                print(f"✓ Created account: {acct.name} ({acct.currency})")
            else:
                print(f"  Account already exists: {acct.name}")

        db.flush()

        all_accounts = (
            db.query(Account)
            .filter(Account.user_id == user.id, Account.deleted_at.is_(None))
            .all()
        )
        account_map = {a.name: a.id for a in all_accounts}
        current_id   = account_map.get("Current Account")
        savings_id   = account_map.get("Savings Account")
        santander_id = account_map.get("Santander España")

        # ── Step 3: Category lookup ─────────────────────────────────────────
        categories = (
            db.query(Category)
            .filter(Category.user_id == user.id, Category.deleted_at.is_(None))
            .all()
        )
        cat_map = {c.name: c.id for c in categories}

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

        if not cat_map:
            raise RuntimeError(
                "Failed to seed default categories for demo user. "
                "Check seed_default_categories() in app/services/categories.py."
            )

        def cat(name: str):
            result = cat_map.get(name)
            if result is None:
                fallback = next(iter(cat_map.values()))
                print(f"  Warning: category '{name}' not found — using fallback")
                return fallback
            return result

        # ── Step 3b: Custom categories for region-specific spending ────────
        # These are user categories (not system) that split generic categories
        # like "Groceries" into region-specific variants for multi-currency demo.
        custom_categories = [
            ("Groceries UK",       cat_map.get("Food & Drink")),
            ("Groceries España",   cat_map.get("Food & Drink")),
            ("Eating Out UK",      cat_map.get("Food & Drink")),
            ("Eating Out España",  cat_map.get("Food & Drink")),
            ("Rent UK",            cat_map.get("Household")),
            ("Rent España",        cat_map.get("Household")),
        ]

        for cat_name, parent_id in custom_categories:
            if cat_name not in cat_map:
                new_cat = Category(
                    user_id=user.id,
                    name=cat_name,
                    parent_category_id=parent_id,
                    is_system=False,
                )
                db.add(new_cat)
                db.flush()
                cat_map[cat_name] = new_cat.id
                print(f"✓ Created custom category: {cat_name}")
            else:
                print(f"  Custom category already exists: {cat_name}")

        db.commit()

        # ── Step 4: Schedules ───────────────────────────────────────────────
        existing_schedules = (
            db.query(Schedule)
            .filter(Schedule.user_id == user.id, Schedule.deleted_at.is_(None))
            .all()
        )
        existing_schedule_names = {s.name for s in existing_schedules}

        new_schedules = [
            # ── GBP monthly schedules ──────────────────────────────────────
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Rent UK"), name="Monthly Rent",
                payee="Landlord", amount=Decimal("950.00"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=1,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Utilities"), name="Electricity Bill",
                payee="British Gas", amount=Decimal("75.00"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=15,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Phone & Internet"), name="Broadband",
                payee="BT", amount=Decimal("45.00"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=20,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Streaming"), name="Netflix",
                payee="Netflix", amount=Decimal("15.99"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=8,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Streaming"), name="Spotify",
                payee="Spotify", amount=Decimal("9.99"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=12,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Fitness"), name="Gym Membership",
                payee="Pure Gym", amount=Decimal("25.00"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=1,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Salary"), name="GBP Salary",
                payee="UK Employer", amount=Decimal("2500.00"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=28,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id,
                account_id=savings_id if savings_id else current_id,
                category_id=cat("Savings"), name="Monthly Savings Transfer",
                payee="Nationwide Savings", amount=Decimal("300.00"), currency="GBP",
                frequency="monthly", interval=1, day_of_month=28,
                start_date=date(2026, 1, 1), auto_generate=False, active=True,
            ),

            # ── EUR monthly schedules (Santander España) ───────────────────
            Schedule(
                user_id=user.id, account_id=santander_id,
                category_id=cat("Salary"), name="EUR Freelance Income",
                payee="Barcelona Client", amount=Decimal("1800.00"), currency="EUR",
                frequency="monthly", interval=1, day_of_month=25,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=santander_id,
                category_id=cat("Rent España"), name="Barcelona Rent",
                payee="Propietario", amount=Decimal("900.00"), currency="EUR",
                frequency="monthly", interval=1, day_of_month=1,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=santander_id,
                category_id=cat("Phone & Internet"), name="Spanish Mobile",
                payee="Movistar", amount=Decimal("25.00"), currency="EUR",
                frequency="monthly", interval=1, day_of_month=10,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),

            # ── Annual schedules ───────────────────────────────────────────
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Streaming"), name="Claude.ai Pro",
                payee="Anthropic", amount=Decimal("240.00"), currency="GBP",
                frequency="annually", interval=1, day_of_month=1,
                start_date=date(2026, 1, 1), auto_generate=True, active=True,
            ),
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Gifts & Celebrations"), name="Christmas Budget",
                payee=None, amount=Decimal("500.00"), currency="GBP",
                frequency="annually", interval=1, day_of_month=1,
                start_date=date(2026, 12, 1), auto_generate=False, active=True,
            ),

            # ── Quarterly schedule ─────────────────────────────────────────
            Schedule(
                user_id=user.id, account_id=current_id,
                category_id=cat("Medical"), name="Quarterly Massage",
                payee="Wellness Studio", amount=Decimal("65.00"), currency="GBP",
                frequency="quarterly", interval=1, day_of_month=15,
                start_date=date(2026, 1, 1), auto_generate=False, active=True,
            ),
        ]

        for sched in new_schedules:
            if sched.name not in existing_schedule_names:
                db.add(sched)
                print(f"✓ Created schedule: {sched.name} ({sched.currency})")
            else:
                print(f"  Schedule already exists: {sched.name}")

        db.commit()

        # ── Step 5: Rolling transactions ────────────────────────────────────
        # Generate transactions for the 3 months prior to today plus the
        # current month. Re-running the script adds any missing transactions
        # for new months automatically.
        #
        # Status: cleared for past months; cleared (early) or pending (late)
        # for the current month.
        #
        # Idempotency key: (date, payee, amount, currency)

        existing_transactions = (
            db.query(Transaction)
            .filter(Transaction.user_id == user.id, Transaction.deleted_at.is_(None))
            .all()
        )
        existing_tx_keys = {
            (str(t.date), t.payee or "", f"{t.amount:.2f}", t.currency)
            for t in existing_transactions
        }

        def tx_status(tx_date: date, cutoff_day: int = 10) -> str:
            """cleared unless it's in the current month and after the cutoff day."""
            if tx_date.year == today.year and tx_date.month == today.month:
                return "cleared" if tx_date.day <= cutoff_day else "pending"
            return "cleared"

        tx_rows = []
        for months_ago in range(3, -1, -1):
            m = _months_back(months_ago)

            # GBP — Current Account
            tx_rows += [
                (current_id,   "Salary",           _date_in_month(m, 28), Decimal("3200.00"), "GBP", "income",  "UK Employer"),
                (current_id,   "Rent UK",          _date_in_month(m,  1), Decimal("1200.00"), "GBP", "expense", "Landlord"),
                (current_id,   "Groceries UK",     _date_in_month(m,  6), Decimal("62.45"),   "GBP", "expense", "Tesco"),
                (current_id,   "Eating Out UK",    _date_in_month(m, 13), Decimal("38.50"),   "GBP", "expense", "Wagamama"),
                (current_id,   "Fuel",             _date_in_month(m, 18), Decimal("55.00"),   "GBP", "expense", "Shell"),
                (current_id,   "Streaming",        _date_in_month(m,  8), Decimal("15.99"),   "GBP", "expense", "Netflix"),
                (current_id,   "Fitness",          _date_in_month(m, 20), Decimal("25.00"),   "GBP", "expense", "Pure Gym"),
            ]

            # EUR — Santander España
            tx_rows += [
                (santander_id, "Salary",              _date_in_month(m, 25), Decimal("1800.00"), "EUR", "income",  "Barcelona Client"),
                (santander_id, "Rent España",         _date_in_month(m,  1), Decimal("900.00"),  "EUR", "expense", "Propietario"),
                (santander_id, "Groceries España",    _date_in_month(m,  4), Decimal("48.20"),   "EUR", "expense", "Mercadona"),
                (santander_id, "Eating Out España",   _date_in_month(m, 10), Decimal("32.00"),   "EUR", "expense", "Bar Marsella"),
                (santander_id, "Phone & Internet", _date_in_month(m, 10), Decimal("25.00"),   "EUR", "expense", "Movistar"),
                (santander_id, "Clothing",         _date_in_month(m, 22), Decimal("65.00"),   "EUR", "expense", "Zara Barcelona"),
            ]

        tx_created = 0
        for acct_id, cat_name, tx_date, amount, currency, tx_type, payee in tx_rows:
            if acct_id is None:
                continue
            key = (str(tx_date), payee, f"{amount:.2f}", currency)
            if key in existing_tx_keys:
                continue

            tx = Transaction(
                user_id=user.id,
                account_id=acct_id,
                category_id=cat(cat_name),
                date=tx_date,
                payee=payee,
                amount=amount,
                currency=currency,
                transaction_type=tx_type,
                status=tx_status(tx_date),
            )
            db.add(tx)
            existing_tx_keys.add(key)
            tx_created += 1

        db.commit()
        if tx_created:
            print(f"✓ Created {tx_created} transactions (rolling window ending {today})")
        else:
            print("  All transactions already exist")

        # ── Step 6: Budgets ─────────────────────────────────────────────
        # Budgets are monthly spending targets for variable categories.
        # Schedules handle fixed recurring transactions (rent, subscriptions);
        # budgets handle discretionary spending (groceries, eating out, etc.).
        #
        # Idempotency: check (user_id, category_id, year) before inserting.
        # For overrides: check (budget_id, month) before inserting.

        BUDGET_YEAR = 2026

        existing_budgets = (
            db.query(Budget)
            .filter(Budget.user_id == user.id, Budget.year == BUDGET_YEAR)
            .all()
        )
        existing_budget_keys = {
            (str(b.category_id), b.year) for b in existing_budgets
        }
        # Map category_id → Budget for override idempotency checks
        budget_by_cat = {str(b.category_id): b for b in existing_budgets}

        # Each entry: (category_name, default_amount, currency, overrides_dict, group)
        # overrides_dict maps month number → override amount
        budget_definitions = [
            # ── GBP budgets — group="UK" ─────────────────────────────────
            ("Groceries UK",         Decimal("300.00"), "GBP", {12: Decimal("350.00")}, "UK"),
            ("Eating Out UK",        Decimal("150.00"), "GBP", {},                      "UK"),
            ("Clothing",             Decimal("100.00"), "GBP", {1: Decimal("200.00"), 12: Decimal("200.00")}, "UK"),
            ("Fuel",                 Decimal("80.00"),  "GBP", {},                      "UK"),
            ("Medical",              Decimal("50.00"),  "GBP", {},                      "UK"),
            ("Gifts & Celebrations", Decimal("50.00"),  "GBP", {12: Decimal("500.00")}, "UK"),
            ("Travel",               Decimal("100.00"), "GBP", {6: Decimal("500.00"), 8: Decimal("300.00")}, "UK"),
            ("Education",            Decimal("50.00"),  "GBP", {},                      "UK"),

            # ── EUR budgets — group="España" ─────────────────────────────
            ("Groceries España",     Decimal("200.00"), "EUR", {},                      "España"),
            ("Eating Out España",    Decimal("100.00"), "EUR", {},                      "España"),
            ("Rent España",          Decimal("900.00"), "EUR", {},                      "España"),
        ]

        budgets_created = 0
        overrides_created = 0

        for cat_name, default_amount, currency, overrides, budget_group in budget_definitions:
            category_id = cat(cat_name)
            key = (str(category_id), BUDGET_YEAR)

            if key in existing_budget_keys:
                # Budget exists — update group if not already set
                budget_obj = budget_by_cat.get(str(category_id))
                if budget_obj and not budget_obj.group:
                    budget_obj.group = budget_group
                    db.add(budget_obj)
                if budget_obj and overrides:
                    existing_override_months = {
                        ov.month for ov in
                        db.query(BudgetOverride)
                        .filter(BudgetOverride.budget_id == budget_obj.id)
                        .all()
                    }
                    for month_num, override_amount in overrides.items():
                        if month_num not in existing_override_months:
                            db.add(BudgetOverride(
                                budget_id=budget_obj.id,
                                month=month_num,
                                amount=override_amount,
                            ))
                            overrides_created += 1
                continue

            # Create the budget
            budget_obj = Budget(
                user_id=user.id,
                category_id=category_id,
                year=BUDGET_YEAR,
                default_amount=default_amount,
                currency=currency,
                group=budget_group,
            )
            db.add(budget_obj)
            db.flush()  # get the id for overrides
            budgets_created += 1
            existing_budget_keys.add(key)
            budget_by_cat[str(category_id)] = budget_obj

            # Create overrides for this budget
            for month_num, override_amount in overrides.items():
                db.add(BudgetOverride(
                    budget_id=budget_obj.id,
                    month=month_num,
                    amount=override_amount,
                ))
                overrides_created += 1

        db.commit()

        if budgets_created or overrides_created:
            print(f"✓ Created {budgets_created} budgets, {overrides_created} overrides (year {BUDGET_YEAR})")
        else:
            print(f"  All budgets already exist for {BUDGET_YEAR}")

        # ── Step 7: Promotions ──────────────────────────────────────────
        existing_promos = (
            db.query(Promotion)
            .filter(Promotion.user_id == user.id)
            .all()
        )
        existing_promo_names = {p.name for p in existing_promos}

        promo_definitions = [
            Promotion(
                user_id=user.id,
                account_id=current_id,
                name="MBNA Balance Transfer",
                promotion_type="balance_transfer",
                original_balance=Decimal("2000.00"),
                interest_rate=Decimal("0.00"),
                start_date=today - timedelta(days=30),
                end_date=today + timedelta(days=180),
                minimum_monthly_payment=Decimal("50.00"),
                is_active=True,
                notes="0% balance transfer from old credit card. Must clear by end date.",
            ),
            Promotion(
                user_id=user.id,
                account_id=current_id,
                name="PayPal BNPL - MacBook",
                promotion_type="bnpl",
                original_balance=Decimal("800.00"),
                interest_rate=Decimal("0.00"),
                start_date=today - timedelta(days=60),
                end_date=today + timedelta(days=60),
                minimum_monthly_payment=None,
                is_active=True,
                notes="PayPal Pay in 4. Must clear before promo ends.",
            ),
        ]

        promos_created = 0
        for promo in promo_definitions:
            if promo.name not in existing_promo_names:
                db.add(promo)
                promos_created += 1
                print(f"✓ Created promotion: {promo.name}")
            else:
                print(f"  Promotion already exists: {promo.name}")

        db.commit()

        print("\nDemo seed complete.")
        print(f"  Accounts : Nationwide Current (GBP) · Nationwide Savings (GBP) · Santander España (EUR)")
        print(f"  Schedules: {len(new_schedules)} total — monthly GBP + EUR, annual (Claude.ai, Christmas), quarterly (Massage)")
        print(f"  Budgets  : {len(budget_definitions)} budget definitions for {BUDGET_YEAR}")
        print(f"  Window   : {_months_back(3).strftime('%B %Y')} → {today.strftime('%B %Y')}")

    except Exception as e:
        db.rollback()
        print(f"Error during seeding: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo()
