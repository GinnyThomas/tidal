# CLAUDE.md — Project Context for Claude Code

This file is read automatically by Claude Code on startup.
It provides context about the project, the developer, and how we work together.

---

## The Developer

**Name:** Ginny Thomas
**Background:** Full Stack Engineer with 4 years production experience (Scala/Play
Framework at HMRC via Capgemini). Former MSc Family Nurse Practitioner.
Completed Makers Academy bootcamp.
**Current situation:** Relocating to Barcelona in June 2026. Actively job hunting.
**Experience level:** Mid-level engineer. Building first full-stack Python/React app.
**Learning goals:** Understand every decision. Explain confidently in interviews.

---

## How We Work Together

- Explain what you are doing and why before writing code
- Add clear comments — Ginny needs to understand every line
- Never generate code silently — always explain the approach
- Point out industry convention vs project-specific decisions
- Flag anything that needs revisiting later
- TDD throughout: Red → Green → Refactor
- pytest for backend, Vitest + RTL for frontend

---

## The Project

**Name:** Tidal
**Purpose:** Multi-currency personal finance tracker — a living spreadsheet.

**Live URLs:**
- Frontend: https://tidal-vert.vercel.app
- Backend: https://tidal-production.up.railway.app
- Docs: https://tidal-production.up.railway.app/docs
- Demo: demo@tidal.app / TidalDemo2026!

**Core problems solved:**
1. Pending transactions corrupt budget views
2. No structured way to plan variable spending (groceries, eating out)
3. Multi-currency household management (UK + España)
4. Cash flow forecasting per budget group
5. Interest promotion tracking (0% deals, BNPL)

---

## Tech Stack

**Backend:** Python 3.13 · FastAPI · PostgreSQL 16 · SQLAlchemy 2.x · Alembic · Pydantic v2 · pytest
**Frontend:** React 19 · TypeScript · Vite · React Router v7 · Tailwind CSS v4 · Vitest + RTL
**Infra:** Railway (backend) · Vercel (frontend) · Supabase (PostgreSQL)

---

## All Phases Complete — 324 Tests

- ✅ Phase 0: Walking skeleton
- ✅ Phase 1: Auth (JWT, bcrypt, refresh token, auto-refresh in frontend)
- ✅ Phase 2: Accounts (CRUD, soft delete, edit, dynamic balance, drill-down)
- ✅ Phase 3: Categories (hierarchy, is_income flag, hide/unhide, edit, drill-down)
- ✅ Phase 4: Transactions (4 types, edit, status toggle, sort, promotion link)
- ✅ Phase 5: Schedules (recurrence, group, next_occurrence, active toggle)
- ✅ Phase 6: Monthly Plan View (plan service, schedule breakdown, reallocation UI)
- ✅ Phase 7: Reallocation (immutable audit trail, inline form, history section)
- ✅ Phase 8: Styling & Polish (ocean theme, mobile, demo, annual view, drill-downs)
- ✅ Phase 9: Budgets (annual defaults, monthly overrides, Set Pattern, groups)
- ✅ Phase 10: Promotions, cash flow, opening balances, transfer editing, UX polish

**Test counts: 109 backend · 215 frontend · 324 total**

---

## What's Built

**Backend — 109 tests:**
- `app/models/` — User, Account, Category, Transaction, Schedule, Reallocation,
  Budget, BudgetOverride, Promotion, GroupOpeningBalance
- `app/routers/` — auth (+ refresh), accounts, categories, transactions,
  schedules, reallocations, plan, budgets, promotions, opening_balances
- `app/services/plan.py` — recurrence engine, budget integration, group filter,
  schedule breakdown, next_occurrence, cash flow
- `migrations/` — 11 Alembic migrations applied to Supabase
- `scripts/seed_demo.py` — rolling demo data, multi-currency, idempotent

**Frontend — 215 tests:**
- Pages: Dashboard, Annual (cash flow), Budgets, Promotions, Transactions,
  Accounts, Categories, Schedules, ChangePassword
- Forms: AddAccount, AddCategory, AddTransaction, AddTransfer, AddSchedule,
  AddBudget, AddPromotion, AddReallocation, BudgetOverrideForm
- `lib/annualPlanCache.ts` — session cache with group-aware keys
- `lib/budgetGroups.ts` — shared GROUP_ORDER constant
- `lib/categories.ts` — sortCategoriesByName helper
- `lib/currencies.ts` — CURRENCIES dropdown constant
- `lib/axiosConfig.ts` — 401 handler + JWT auto-refresh (< 15 min expiry)
- `lib/api.ts` — getApiBaseUrl()

---

## Key Feature Details

**Budget Groups (UK / España / General):**
- `group` field on both budgets AND schedules
- Plan view, Annual view, Budgets page all filter/section by group
- GROUP_ORDER = ['UK', 'España', 'General'] in lib/budgetGroups.ts
- Schedules group used as fallback when no budget group exists for a category

**Cash Flow (Annual View):**
- "Show cash flow" toggle — always visible
- Opening balance per group per year (group_opening_balances table)
- Closing balance = opening + income - expenses per month, rolling forward
- Income determined by `is_income` flag on Category model
- December closing → suggested carry-forward to next year
- Opening balance cell is click-to-edit inline

**Interest Promotion Tracker:**
- Tracks 0% balance transfers, BNPL, deferred interest
- Computed fields: days_remaining, urgency (critical/warning/caution/ok/expired),
  total_paid (from linked transactions), remaining_balance, required_monthly_payment
- Urgency thresholds: ≤5 days critical, ≤30 warning, ≤60 caution
- Transactions can be linked to a promotion via promotion_id
- Delete blocked if linked transactions exist (409)

**Dynamic Account Balances:**
- `calculated_balance` = opening_balance + sum(income) - sum(expenses)
- Only cleared/reconciled transactions count
- Transfers: debit leg reduces balance, credit leg increases
- Pending excluded

**Schedule next_occurrence:**
- Computed on every schedule response
- Uses get_next_occurrence() in plan.py
- Returns None if schedule has ended (end_date in past)
- Month normalization uses 0-based arithmetic to avoid off-by-one

**Transfer Handling:**
- Transfers have no category (category_id = NULL)
- Both legs editable via AddTransferForm in edit mode
- Edit finds linked leg via parent_transaction_id query

**is_income Flag:**
- Boolean on Category model, default false
- Seeded true for: Salary, Freelance, Reimbursements, Income parent
- Used by cash flow to determine if a category adds to or subtracts from balance
- Visible as teal "income" badge on CategoriesPage
- Toggle in AddCategoryForm

**Budget Override Set Pattern:**
- Monthly: set all 12 months to same amount
- Quarterly: set 4 months (choice of which quarter start)
- Annual: set 1 month, clear other 11
- Clear all: delete all overrides
- Auto-select on focus, keyboard navigation between months (Enter → next month)

---

## Plan View Assembly

planned = schedule amounts + budget amounts per category per month:
1. Schedules: amount × occurrences_in_month, grouped by category
2. Budgets: override amount or default_amount, filtered by group
3. Reallocations: adjustments applied after
4. Actual: cleared+reconciled transactions
5. Pending: pending transactions
6. Remaining: planned - actual

Cash flow (Annual only):
- Income rows (is_income=true): add to closing balance
- Expense rows: subtract from closing balance
- Transfers: excluded from cash flow
- Opening balance: manually set per group per year

---

## Demo Account

- demo@tidal.app / TidalDemo2026!
- 3 accounts: Nationwide Current (GBP), Nationwide Savings (GBP), Santander España (EUR)
- 14 schedules with groups: monthly GBP + EUR, annual, quarterly
- 11 budgets: UK group (GBP) + España group (EUR) with overrides
- 2 promotions: MBNA Balance Transfer (OK), PayPal BNPL MacBook (CAUTION)
- Rolling transactions: 3 months back + current month
- Refresh: `./scripts/refresh_demo.sh`

---

## Important Reminders

- sa.Uuid() → sa.Uuid(as_uuid=True) in all migrations
- NOT NULL columns need server_default in migration
- ALLOWED_ORIGINS in Railway: no trailing slash
- Migrations: direct URL port 5432; app uses pooled port 6543
- `from datetime import date as date_` — Pydantic v2 shadowing
- `group` is reserved in PostgreSQL — quote as `"group"` in raw SQL
- Supabase "No rows returned" = UPDATE/DELETE succeeded (not an error)
- Railway free tier cold starts ~30s — upgrade to Hobby ($5/mo) for always-on
- JWT auto-refresh triggers when < 15 minutes remaining on token
- category_id required for expense/income/refund, nullable for transfers
- Delete promotion blocked (409) if linked transactions exist
- Transfers: both legs updated simultaneously in edit mode

---

## Known Tech Debt

- Annual view makes 12 separate plan API calls (N×12 queries) — needs single-pass service
- N+1 on list_accounts balance calculation — needs SQL aggregation
- sessionStorage for annual cache (currently in-memory, clears on refresh)
- React Query not wired up — plain useEffect + useState throughout
- Schedule breakdown shows pre-reallocation amounts
- No per-schedule actual spend (schedule_id FK exists but unused)
- Split transactions not yet built (Amazon use case)
- Reallocation frontend done but no delete/edit (immutable by design)
- Currency consolidation (exchange_rate exists, conversion logic not built)
- Open Banking / bank sync (Phase 11)
- Google OAuth (Phase 11)
- Clickable row anywhere = edit for ALL pages (partially done)

---

## Running the Project

```bash
# Backend
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload

# Frontend
cd frontend && npm run dev

# Tests
cd backend && python -m pytest tests/ -v
cd frontend && npm run test:run

# Production migrations
DATABASE_URL="postgresql://postgres:PASSWORD@db.msframaqmymeunoqmtjr.supabase.co:5432/postgres" alembic upgrade head

# Refresh demo
cd backend && ./scripts/refresh_demo.sh
```

---

## Project Structure

```
tidal/
├── backend/
│   ├── app/
│   │   ├── models/      10 SQLAlchemy models
│   │   ├── schemas/     Pydantic schemas for all entities
│   │   ├── routers/     10 API routers
│   │   └── services/    auth, categories, plan (recurrence + cash flow)
│   ├── migrations/      11 Alembic migrations
│   └── scripts/         seed_demo.py, refresh_demo.sh
├── frontend/
│   ├── src/
│   │   ├── pages/       10 page components
│   │   ├── components/  9 form components + Layout
│   │   └── lib/         api, axiosConfig, annualPlanCache,
│   │                    budgetGroups, categories, currencies
│   └── vercel.json
└── docs/
    ├── architecture.png
    └── screenshots/
```

---

## Phase 11 — Planned Features

- Split transactions (one transaction → multiple categories, Amazon use case)
- Currency consolidation (exchange_rate exists, conversion logic needed)
- Reallocation delete/edit (currently immutable — may stay that way by design)
- Open Banking / TrueLayer / Plaid for automatic import
- Google OAuth
- Per-schedule actual spend tracking
- sessionStorage for annual cache persistence
- Batch budget override endpoint (eliminate N+1 on pattern apply)
- Railway Hobby upgrade for always-on (eliminates cold start)

---

*Last updated: April 2026 — All phases complete*
*324 tests · Live at tidal-vert.vercel.app*
