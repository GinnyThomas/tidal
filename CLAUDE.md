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
5. Variable spending targets can't be set without creating fake schedules

**The primary view** is a Monthly Plan View — a single screen showing every
budget category with planned vs actual vs remaining, grouped by budget group
(UK / España / General). Transactions are accessible inline.

**Key principle:** Plan first, track second. Schedules define fixed recurring
transactions. Budgets define variable spending targets. Transactions confirm
reality. The gap between them is where insight lives.

---

## Tech Stack

**Backend:**
- Python 3.13.7
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

## Current Phase

**Phase 9 — Budgets (complete)**

All phases complete:
- ✅ Phase 0: Walking skeleton
- ✅ Phase 1: Authentication (register, login, JWT, bcrypt, change password)
- ✅ Phase 2: Accounts (CRUD, soft delete, edit, drill-down to transactions)
- ✅ Phase 3: Categories (hierarchical, system seeding, hide/unhide, edit, drill-down)
- ✅ Phase 4: Transactions (expense/income/transfer/refund, edit, status toggle, sort)
- ✅ Phase 5: Schedules (recurrence engine, edit, active toggle)
- ✅ Phase 6: Monthly Plan View (plan service, schedule breakdown, expand/collapse,
               budget group sections with subtotals)
- ✅ Phase 7: Reallocation (immutable audit trail, plan integration)
- ✅ Phase 8: Styling & Polish (ocean theme, mobile responsive, demo account,
               annual view, category drill-down, multi-currency demo)
- ✅ Phase 9: Budgets (annual budgets with monthly overrides, budget groups,
               Budgets page, Annual view group sections)

Next: Phase 10 features (see bottom of file)

---

## What's Built

**Backend — 88 tests passing:**
- `app/models/` — User, Account, Category, Transaction, Schedule, Reallocation,
                   Budget, BudgetOverride
- `app/schemas/` — Pydantic v2 schemas for all entities
- `app/services/auth.py` — bcrypt hashing, JWT creation, get_current_user
- `app/services/categories.py` — seed_default_categories (35 categories, atomic)
- `app/services/plan.py` — recurrence engine, plan assembly, budget integration,
                            reallocation adjustment, group field on PlanRow
- `app/routers/auth.py` — register, login, change-password
- `app/routers/accounts.py` — full CRUD, soft delete, user-scoped
- `app/routers/categories.py` — full CRUD, toggle-visibility, system protection
- `app/routers/transactions.py` — expense/income/transfer/refund, category/status filter
- `app/routers/schedules.py` — full CRUD, toggle-active, recurrence
- `app/routers/reallocations.py` — POST/GET only, immutable, reason required
- `app/routers/plan.py` — GET /plan/{year}/{month}?group= and GET /plan/{year}?group=
- `app/routers/budgets.py` — CRUD + override upsert/delete, group filter
- `migrations/` — 10 Alembic migrations applied to Supabase
- `scripts/seed_demo.py` — rolling demo data, multi-currency GBP+EUR, budget groups
- `scripts/refresh_demo.sh` — convenience wrapper for production seeding

**Frontend — 183 tests passing:**
- `LoginPage.tsx` — JWT auth, show/hide password, Try Demo button
- `RegisterPage.tsx` — register + auto-login, password confirmation
- `ProtectedRoute.tsx` — redirects to /login if no token
- `AccountsPage.tsx` — list, add, edit, drill-down to transactions
- `AddAccountForm.tsx` — create/edit account
- `CategoriesPage.tsx` — two-column hierarchy, hide/unhide, edit, drill-down
- `AddCategoryForm.tsx` — create/edit with colour picker and emoji icon grid
- `TransactionsPage.tsx` — list, add, edit, status toggle, multi-filter, sort by all columns
- `AddTransactionForm.tsx` — create/edit expense/income/refund
- `AddTransferForm.tsx` — create transfer between accounts
- `SchedulesPage.tsx` — list, add, edit, active toggle, show inactive
- `AddScheduleForm.tsx` — create/edit with frequency-conditional fields
- `BudgetsPage.tsx` — annual budgets with group sections, overrides inline
- `AddBudgetForm.tsx` — create/edit budget with group selector
- `BudgetOverrideForm.tsx` — 12-month grid for month-specific overrides
- `MonthlyPlanView.tsx` — primary dashboard, schedule breakdown, group sections + subtotals
- `AnnualView.tsx` — 12-month spreadsheet, group sections + subtotals, session cache
- `ChangePasswordPage.tsx` — change password with show/hide toggles
- `DemoButton.tsx` — one-click demo login
- `Layout.tsx` — responsive nav, hamburger menu, logout
- `lib/axiosConfig.ts` — global 401 interceptor → auto-logout
- `lib/annualPlanCache.ts` — session cache invalidated on data mutations
- `lib/api.ts` — getApiBaseUrl() helper
- `lib/budgetGroups.ts` — shared GROUP_ORDER constant ['UK', 'España', 'General']
- Routes: /login, /register, /dashboard, /plan, /transactions, /accounts,
          /categories, /schedules, /budgets, /annual, /change-password

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

**Component classes (index.css):**
`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input-base`, `.label-base`,
`.card`, `.card-hover`, `.badge`, `.badge-sky`, `.badge-teal`, `.page-container`

**Budget group sections:**
Shared constant in `lib/budgetGroups.ts`: `GROUP_ORDER = ['UK', 'España', 'General']`
Used in MonthlyPlanView, AnnualView, BudgetsPage for consistent section ordering.

---

## API Conventions

- Base URL: `/api/v1/`
- Auth: JWT Bearer token — `Authorization: Bearer <token>`
- All responses: JSON
- Amounts as strings (not floats) — NUMERIC serialised to string
- Dates: ISO 8601 (YYYY-MM-DD)
- Status codes: 200/201/204/400/401/403/404/409/422
- Logical deletes — never physically delete records (except budgets, TagAssignment)
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

## Category Rules

- System categories (is_system=True) cannot be deleted — return 403
- System categories CAN be edited (name, colour, icon) and hidden
- Hiding a parent cascades to direct children (one level only)
- Default list excludes hidden — pass ?include_hidden=true to see them
- 35 system categories seeded atomically on user registration
- Custom categories can be soft-deleted
- Duplicate category names per user rejected with 422

---

## Budget Rules

- One budget per category per year (unique constraint: user_id, category_id, year)
- `default_amount` applies to all months unless overridden
- `budget_overrides` table stores month-specific amounts (upsert semantics)
- Budget amounts and schedule amounts are additive per category
- Budgets can be hard-deleted (unlike transactions which are soft-deleted)
- Optional `group` field (max 50 chars) — e.g. "UK", "España"
- Plan view: filter by group shows only that group's budget contributions
- Group filter applies to budgets only — schedules and transactions are NOT filtered

---

## Plan View Assembly

For a given month, planned = schedule amounts + budget amounts per category:
1. Schedules: sum of schedule.amount × occurrences_in_month per category
2. Budgets: budget amount for that month (override or default) per category
3. Reallocations: adjustments applied after schedules+budgets
4. Actual: sum of cleared+reconciled transactions per category
5. Pending: sum of pending transactions per category
6. Remaining: planned - actual
7. Group: from budget's group field (for section rendering in UI)

Note: schedule breakdown rows show pre-reallocation amounts — their sum
may differ from the final planned total when reallocations have been applied.

When group filter is active: only budgets matching that group contribute to
planned totals. Schedules and transactions are always included regardless.

---

## Demo Account

- Email: demo@tidal.app / Password: TidalDemo2026!
- 3 accounts: Nationwide Current (GBP), Nationwide Savings (GBP), Santander España (EUR)
- 14 schedules: monthly GBP + EUR, annual (Claude.ai Pro, Christmas), quarterly (Massage)
- 11 budgets: 8 UK/GBP group, 3 España/EUR group, with monthly overrides
- Rolling transactions: always covers 3 months back + current month
- Multi-currency: GBP transactions on Nationwide, EUR on Santander España
- Region-specific categories: Groceries UK/España, Eating Out UK/España, Rent UK/España
- To refresh: `./scripts/refresh_demo.sh` (reads DATABASE_URL from .env)

---

## Known Issues / Tech Debt

- O(n²) childrenOf() in CategoriesPage — fix with useMemo + Map
- Annual view makes 12 × N plan API calls — optimise with single-pass service (Phase 10)
- React Query not wired up — using plain useEffect + useState
- Schedule breakdown in plan view shows pre-reallocation amounts
- No per-schedule actual spend tracking (transactions tagged to categories not schedules)
- sessionStorage for annual cache (currently in-memory, clears on refresh)
- Currency consolidation: EUR + GBP amounts are additive in plan view without conversion
- Demo data has some duplicate generic categories alongside UK/España variants

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
- `date` field in schemas must use `date as date_` alias to avoid Pydantic v2 shadowing
- `group` is a reserved word in PostgreSQL — always quote it as `"group"` in raw SQL
- GROUP_ORDER constant lives in `frontend/src/lib/budgetGroups.ts` — import from there

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
│   │   ├── models/           User, Account, Category, Transaction, Schedule,
│   │   │                     Reallocation, Budget, BudgetOverride
│   │   ├── schemas/          Pydantic request/response shapes
│   │   ├── routers/          auth, accounts, categories, transactions, schedules,
│   │   │                     reallocations, plan, budgets
│   │   └── services/         auth, categories seeding, plan assembly
│   ├── migrations/           10 Alembic migration files
│   ├── scripts/
│   │   ├── seed_demo.py      idempotent demo data seeder
│   │   └── refresh_demo.sh   convenience wrapper for production seeding
│   ├── Procfile              Railway start command
│   ├── runtime.txt           Python version for Railway
│   └── tests/                pytest test suite (88 tests)
├── frontend/
│   ├── src/
│   │   ├── pages/            all page components
│   │   ├── components/       reusable UI components
│   │   └── lib/              api.ts, axiosConfig.ts, annualPlanCache.ts,
│   │                         budgetGroups.ts
│   ├── vercel.json           SPA rewrite for Vercel
│   └── .env.example          VITE_API_URL template
└── docs/
    ├── PRD.md
    ├── TDD.md
    ├── PROJECT_PLAN.md
    └── architecture.png
```

---

## Phase 10 — Planned Features

### Currency Consolidation
The `exchange_rate` column exists on every transaction — data model is ready.
Needs: base currency per user, conversion logic in plan service, consolidated
totals in plan/annual views. "Net worth in one currency" view.

### Interest Promotion Tracker
Track 0% interest promotions (Paypal BNPL, credit card balance transfers).
`promotions` table: name, account_id, original_balance, promotion_end_date,
minimum_monthly_payment, is_active.
Features: days remaining, required monthly payment, warning < 60 days.

### Per-Schedule Actual Spend
Link transactions to schedules via schedule_id (column exists, FK wired).
Would enable "Netflix planned £15.99, actual £15.99" in plan view breakdown.

### Open Banking / Bank Sync
TrueLayer or Plaid for automatic transaction import.
Requires OAuth per bank + webhook processing.

### Google OAuth
authlib integration. Users table gets optional google_id column.

### Tags
Cross-cutting transaction labels via TagAssignment join table.

### Annual View Performance
Replace 12 × N plan API calls with single-pass annual service.

---

*Last updated: Phase 9 complete — April 2026*
