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
Building this project to strengthen GitHub profile and demonstrate Python + React skills.
**Experience level:** Mid-level engineer with strong real-world experience but
limited formal CS education. Building first full-stack app from scratch.
**Learning goals:** Understand every decision made in this codebase. Be able to
explain all of it confidently in a technical interview.

---

## How We Work Together

**This is a learning project first, a portfolio project second.**

- Explain what you are doing and why before writing code
- Add clear comments to every file — Ginny needs to understand every line
- Never just generate code silently — always explain the approach
- If there are multiple ways to do something, briefly explain the tradeoffs
  and which approach we are taking and why
- Point out when something is an industry convention vs a project-specific decision
- Flag anything that will need to be revisited or improved later

**We practise Test Driven Development (TDD) throughout.**

- Tests are written before implementation — Red, Green, Refactor
- Test behaviour not implementation
- Every feature has tests before it is considered done
- pytest for backend, Vitest + React Testing Library for frontend

**Code style:**
- Clear over clever — readable code is better than terse code
- Meaningful variable and function names
- No magic numbers or unexplained constants
- Type hints on all Python functions
- TypeScript types on all React components

---

## The Project

**Name:** Tidal
**Purpose:** A multi-currency personal finance tracker that feels like a
living spreadsheet. Solves real problems with existing apps like Spendee.

**Live URLs:**
- Frontend: https://tidal-vert.vercel.app
- Backend API: https://tidal-production.up.railway.app
- API Docs: https://tidal-production.up.railway.app/docs
- Demo: click "Try Demo 🌊" on the login page (demo@tidal.app / TidalDemo2026!)

**Core problems being solved:**
1. Pending transactions corrupt budget views in existing apps
2. Recurring merchants are repeatedly mis-categorised
3. Budget and transaction views are separated — hard to see the full picture
4. No structured way to track budget reallocation decisions
5. Variable spending targets (groceries, eating out) couldn't be set without schedules

**The primary view** is a Monthly Plan View — a single screen showing every
budget category with planned vs actual vs remaining vs pending. Budget groups
(UK / España / General) allow multi-currency household management.

**Key principle:** Plan first, track second. Schedules define fixed recurring
transactions. Budgets define variable spending targets. Transactions confirm
reality. The gap between them is where insight lives.

---

## Tech Stack

**Backend:**
- Python 3.13
- FastAPI
- PostgreSQL 16 (hosted on Supabase in production)
- SQLAlchemy 2.x (ORM)
- Alembic (migrations)
- Pydantic v2 (validation)
- pytest (testing)

**Frontend:**
- React 19 + TypeScript
- Vite
- React Router v7
- Tailwind CSS v4 (ocean/water colour theme)
- Vitest + React Testing Library (testing)

**Infrastructure:**
- Backend: Railway (Procfile, $PORT, ALLOWED_ORIGINS env var)
- Frontend: Vercel (vercel.json SPA rewrite, VITE_API_URL env var)
- Database: Supabase (PostgreSQL, pooled connection port 6543)

---

## Current State — All Phases Complete

- ✅ Phase 0: Walking skeleton
- ✅ Phase 1: Authentication (register, login, JWT, bcrypt, Alembic)
- ✅ Phase 2: Accounts (CRUD, soft delete, edit, drill-down to transactions)
- ✅ Phase 3: Categories (hierarchical, system seeding, hide/unhide, edit, drill-down)
- ✅ Phase 4: Transactions (expense/income/transfer/refund, edit, status toggle, sort)
- ✅ Phase 5: Schedules (recurrence engine, edit, active toggle)
- ✅ Phase 6: Monthly Plan View (plan service, schedule breakdown, expand/collapse)
- ✅ Phase 7: Reallocation (immutable audit trail, plan integration)
- ✅ Phase 8: Styling & Polish (ocean theme, mobile responsive, demo account,
               annual view, category drill-down, multi-currency demo)
- ✅ Phase 9: Budgets (variable spending targets, annual defaults, monthly overrides,
               budget groups UK/España/General, group sections in all views)

**Test counts: 88 backend · 183 frontend · 271 total**

---

## What's Built

**Backend — 88 tests passing:**
- `app/models/` — User, Account, Category, Transaction, Schedule, Reallocation, Budget, BudgetOverride
- `app/schemas/` — Pydantic v2 schemas for all entities, PlanRow (group, schedules), ScheduleRow, AnnualPlan, BudgetResponse
- `app/services/auth.py` — bcrypt hashing, JWT creation, get_current_user
- `app/services/categories.py` — seed_default_categories (35 categories, atomic)
- `app/services/plan.py` — recurrence engine, budget integration (batch override query), group filter, schedule breakdown
- `app/routers/auth.py` — register, login, change-password
- `app/routers/accounts.py` — full CRUD, soft delete, user-scoped
- `app/routers/categories.py` — full CRUD, toggle-visibility, system protection
- `app/routers/transactions.py` — expense/income/transfer/refund, status/category/account filter
- `app/routers/schedules.py` — full CRUD, toggle-active, recurrence
- `app/routers/reallocations.py` — POST/GET only, immutable, reason required
- `app/routers/plan.py` — monthly + annual endpoints with group filter
- `app/routers/budgets.py` — 7 endpoints, selectinload, category ownership validation, batch override query
- `migrations/` — 9 Alembic migrations applied to Supabase
- `scripts/seed_demo.py` — rolling demo data, multi-currency, 11 budgets, idempotent
- `scripts/refresh_demo.sh` — convenience wrapper for production seeding

**Frontend — 183 tests passing:**
- All pages: Dashboard, Annual, Budgets, Transactions, Accounts, Categories, Schedules, ChangePassword
- All forms: AddAccount, AddCategory (emoji+colour), AddTransaction, AddTransfer, AddSchedule, AddBudget, BudgetOverrideForm
- `lib/annualPlanCache.ts` — session cache with group-aware keys, invalidated on mutations/logout
- `lib/budgetGroups.ts` — shared GROUP_ORDER constant ['UK', 'España', 'General']
- `lib/axiosConfig.ts` — 401 interceptor (excludes auth endpoints)
- `lib/api.ts` — getApiBaseUrl()
- Routes: /login, /register, /dashboard, /transactions, /accounts, /categories,
          /schedules, /budgets, /annual, /change-password

---

## Budget Groups Feature

Budget groups allow multi-currency household management:
- Each budget has an optional `group` field (string, max 50 chars)
- Demo uses "UK" (GBP budgets) and "España" (EUR budgets)
- Plan view, Annual view, and Budgets page all support group filtering
- When "All" is selected and multiple groups exist, section headers appear:
  ── UK ── / ── España ── / ── GENERAL ──
- Each section shows a subtotal row (planned, actual, remaining, pending)
- GROUP_ORDER = ['UK', 'España', 'General'] in `lib/budgetGroups.ts`
- Schedules and transactions are NOT filtered by group — only budgets are
- A parent category appears in each section that has matching children

---

## Plan View Assembly

For a given month, planned = schedule amounts + budget amounts per category:
1. Schedules: sum of schedule.amount × occurrences_in_month per category
2. Budgets: budget amount for that month (override or default) per category,
   filtered by group if group param provided
3. Reallocations: adjustments applied after schedules+budgets
4. Actual: sum of cleared+reconciled transactions per category
5. Pending: sum of pending transactions per category
6. Remaining: planned - actual

Note: schedule breakdown rows show pre-reallocation amounts — their sum
may differ from the final planned total when reallocations have been applied.

---

## Design System

**Colour palette — ocean/water theme:**
- Background: ocean-900 (#0f1923)
- Surface/cards: ocean-800 (#1a2a3a)
- Borders: ocean-700 (#2a3f52)
- Primary: sky-500 (#0ea5e9)
- Teal accent: teal-500 (#14b8a6)
- CTA/alert: coral-500 (#f43f5e)
- Text primary: slate-100 · Text muted: slate-400
- Success/positive: #10b981 · Danger/overspent: #ef4444 · Pending: #f59e0b

---

## API Conventions

- Base URL: `/api/v1/`
- Auth: JWT Bearer token — `Authorization: Bearer <token>`
- All responses: JSON
- Amounts as strings (not floats) — NUMERIC serialised to string
- Dates: ISO 8601 (YYYY-MM-DD)
- Status codes: 200/201/204/400/401/403/404/409/422
- Logical deletes — never physically delete records (except budgets)
- user_id always comes from the JWT token — never from the request body
- Email normalised to lowercase at app layer + func.lower() at DB query layer

---

## Transaction Rules

- **expense** — money out, reduces category actual spend (cleared/reconciled only)
- **income** — money in, does not affect budget spend
- **transfer** — creates TWO linked transactions via parent_transaction_id
- **refund** — links to parent via parent_transaction_id, parent required
- **pending** — excluded from budget actual spend by default
- **cleared** — counts toward actual spend
- **reconciled** — user confirmed against bank statement, counts toward actual spend
- Transfer rows cannot be edited via AddTransactionForm (disabled Edit button)

---

## Budget Rules

- One budget per category per year (unique constraint: user_id, category_id, year)
- `default_amount` applies to all months unless overridden
- `budget_overrides` table stores month-specific amounts (upsert semantics)
- Budget amounts and schedule amounts are additive per category
- Budgets can be hard-deleted (unlike transactions which are soft-deleted)
- Plan view: for each month, uses override amount if exists, else default_amount
- Category ownership validated before creating budget (prevents cross-user injection)
- Overrides loaded in batch (single .in_() query, not N+1)
- group field: optional string max 50 chars, can be cleared (set to null)

---

## Demo Account

- Email: demo@tidal.app / Password: TidalDemo2026!
- 3 accounts: Nationwide Current (GBP), Nationwide Savings (GBP), Santander España (EUR)
- 14 schedules: monthly GBP + EUR, annual (Claude.ai Pro £240, Christmas £500),
  quarterly (Massage £65)
- 11 budgets: 8 UK group (GBP) + 3 España group (EUR) with monthly overrides
- Rolling transactions: always covers 3 months back + current month
- Multi-currency: Groceries UK/España, Eating Out UK/España, Rent UK/Rent España
- To refresh: `./scripts/refresh_demo.sh` (reads DATABASE_URL from .env)
- Seed script preserves existing budget groups (only fills in NULL groups)

---

## Known Issues / Tech Debt

- Annual view makes 12 separate plan API calls — optimise with single-pass service
- Salary category mixes GBP + EUR schedules (no currency consolidation yet)
- Duplicate salary schedules in demo (Salary + GBP Salary both active)
- sessionStorage for annual cache (currently in-memory, clears on refresh)
- React Query not wired up — using plain useEffect + useState
- Schedule breakdown shows pre-reallocation amounts
- No per-schedule actual spend tracking (transactions tagged to categories not schedules)
- Clickable rows (anywhere in row = edit/navigate) not yet implemented

---

## Important Reminders

- Never store passwords in plain text — always bcrypt
- Never commit .env files — .env.example only
- Always scope database queries to the authenticated user_id
- Pending transactions excluded from budget actual spend by default
- Reallocation records are never deleted — not even soft deleted
- Financial amounts always use NUMERIC not FLOAT
- sa.Uuid() in migrations must always be sa.Uuid(as_uuid=True)
- Adding NOT NULL columns to existing tables requires server_default in migration
- ALLOWED_ORIGINS in Railway must match Vercel URL exactly (no trailing slash)
- Run migrations against Supabase direct URL (port 5432), not pooled (port 6543)
- date field in schemas: `from datetime import date as date_` (Pydantic v2 shadowing)
- `group` is a reserved word in PostgreSQL — always quote as `"group"` in raw SQL
- Supabase SQL Editor shows "No rows returned" for successful UPDATE/DELETE statements

---

## Running the Project

```bash
# Backend
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload
# http://localhost:8000 · docs: http://localhost:8000/docs

# Frontend
cd frontend && npm run dev
# http://localhost:5173

# Tests
cd backend && python -m pytest tests/ -v
cd frontend && npm run test:run

# Migrations (local)
cd backend && alembic upgrade head
cd backend && alembic revision --autogenerate -m "description"

# Production migrations (Supabase direct URL)
DATABASE_URL="postgresql://postgres:PASSWORD@db.msframaqmymeunoqmtjr.supabase.co:5432/postgres" alembic upgrade head

# Refresh demo data
cd backend && ./scripts/refresh_demo.sh
```

---

## Project Structure

```
tidal/
├── backend/
│   ├── app/
│   │   ├── main.py           FastAPI entry point, router registration
│   │   ├── config.py         pydantic-settings, ALLOWED_ORIGINS
│   │   ├── database.py       SQLAlchemy engine, SessionLocal, get_db
│   │   ├── models/           SQLAlchemy ORM models (8 models)
│   │   ├── schemas/          Pydantic request/response shapes
│   │   ├── routers/          API endpoint handlers (8 routers)
│   │   └── services/         auth, categories seeding, plan assembly
│   ├── migrations/           9 Alembic migration files
│   ├── scripts/
│   │   ├── seed_demo.py      idempotent demo data seeder (6 steps)
│   │   └── refresh_demo.sh   convenience wrapper for production seeding
│   ├── Procfile              Railway start command
│   ├── runtime.txt           Python version for Railway
│   └── tests/                88 pytest tests
├── frontend/
│   ├── src/
│   │   ├── pages/            10 full page components
│   │   ├── components/       reusable UI components + forms
│   │   └── lib/              api.ts, axiosConfig.ts, annualPlanCache.ts,
│   │                         budgetGroups.ts
│   ├── vercel.json           SPA rewrite for Vercel
│   └── .env.example          VITE_API_URL template
└── docs/
    ├── architecture.png
    └── screenshots/
        ├── screenshot-dashboard.png
        ├── screenshot-annual.png
        ├── screenshot-budgets.png
        ├── screenshot-schedules.png
        ├── screenshot-categories.png
        └── screenshot-transactions.png
```

---

## Phase 10 — Planned Features

### Currency Consolidation
The `exchange_rate` column exists on every transaction — the data model is ready.
Needs: base currency per user, conversion logic in plan service, consolidated
totals in plan/annual views. "Net worth in one currency" view.
Interview note: designed for this from day 1, not yet prioritised.

### Interest Promotion Tracker
Track 0% interest promotions (PayPal BNPL, credit card balance transfers).
`promotions` table: name, account_id, original_balance, promotion_end_date,
minimum_monthly_payment, is_active.
Features: days remaining, required monthly payment, warning < 60 days.

### Open Banking / Bank Sync
TrueLayer or Plaid for automatic transaction import.
Requires OAuth per bank + webhook processing.

### Google OAuth
authlib integration. Users table gets optional google_id column.

### Per-Schedule Actual Spend
Link transactions to schedules via schedule_id (column exists, FK not yet used).
Would enable "Netflix planned £15.99, actual £15.99" in plan view breakdown.

### Clickable Rows
Anywhere in a transaction/account/schedule row navigates to edit.
Larger tap target for mobile.

### Tags
Cross-cutting transaction labels via TagAssignment join table.

---

*Last updated: Phase 9 complete — April 2026*
*271 tests passing · All phases complete · Live at tidal-vert.vercel.app*
