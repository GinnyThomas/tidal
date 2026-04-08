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

**Name:** Tidal (working title — product name TBD)
**Purpose:** A multi-currency personal finance tracker that feels like a
living spreadsheet. Solves real problems with existing apps like Spendee.

**Live URLs:**
- Frontend: https://tidal-vert.vercel.app
- Backend API: https://tidal-production.up.railway.app
- API Docs: https://tidal-production.up.railway.app/docs

**Core problems being solved:**
1. Pending transactions corrupt budget views in existing apps
2. Recurring merchants are repeatedly mis-categorised
3. Budget and transaction views are separated — hard to see the full picture
4. No structured way to track budget reallocation decisions

**The primary view** is a Monthly Plan View — a single screen showing every
budget category with planned vs actual vs remaining. Transactions are
accessible inline. Nothing important requires navigating away.

**Key principle:** Plan first, track second. Schedules define what is expected.
Transactions confirm reality. The gap between them is where insight lives.

---

## Tech Stack

**Backend:**
- Python 3.13.7
- FastAPI
- PostgreSQL 16 (hosted on Supabase in production)
- SQLAlchemy 2.x (ORM)
- Alembic (migrations)
- Pydantic v2 (validation)
- pytest + pytest-asyncio + httpx + factory-boy (testing)

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

**Phase 8 — Styling & Polish (in progress)**

All backend phases complete:
- ✅ Phase 0: Walking skeleton
- ✅ Phase 1: Authentication (register, login, JWT, bcrypt, Alembic)
- ✅ Phase 2: Accounts (CRUD, soft delete, frontend)
- ✅ Phase 3: Categories (hierarchical, system seeding, hide/unhide, frontend)
- ✅ Phase 4: Transactions (expense/income/transfer/refund, backend + tests)
- ✅ Phase 5: Schedules (recurrence engine, backend + tests)
- ✅ Phase 6: Monthly Plan View (plan service, recurrence, frontend)
- ✅ Phase 7: Reallocation (immutable audit trail, plan integration)
- 🔄 Phase 8: Styling, transactions frontend, schedules frontend, polish

In progress / remaining:
- 🔄 Tailwind CSS styling (ocean/water theme)
- ⏳ Transactions frontend page
- ⏳ Schedules frontend page
- ⏳ Change password feature
- ⏳ Navigation bar
- ⏳ Demo account with sample data

---

## What's Built

**Backend — 63 tests passing:**
- `app/models/` — User, Account, Category, Transaction, Schedule, Reallocation
- `app/schemas/` — Pydantic v2 schemas for all entities
- `app/services/auth.py` — bcrypt hashing, JWT creation, get_current_user
- `app/services/categories.py` — seed_default_categories (35 categories, atomic)
- `app/services/plan.py` — recurrence engine, plan assembly
- `app/routers/auth.py` — register (seeds categories atomically), login
- `app/routers/accounts.py` — full CRUD, soft delete, user-scoped
- `app/routers/categories.py` — full CRUD, toggle-visibility, system protection
- `app/routers/transactions.py` — expense/income/transfer/refund, status filter
- `app/routers/schedules.py` — full CRUD, toggle-active, recurrence
- `app/routers/reallocations.py` — POST/GET only, immutable, reason required
- `app/routers/plan.py` — GET /api/v1/plan/{year}/{month}
- `migrations/` — 7 Alembic migrations applied to Supabase

**Frontend — 56 tests passing:**
- `LoginPage.tsx` — JWT auth, localStorage token storage
- `RegisterPage.tsx` — register + auto-login, password confirmation
- `ProtectedRoute.tsx` — redirects to /login if no token
- `AccountsPage.tsx` — list/empty/error states, add account form
- `AddAccountForm.tsx` — account creation with JWT auth
- `CategoriesPage.tsx` — hierarchical display, hide/unhide toggle
- `AddCategoryForm.tsx` — category creation with parent dropdown
- `MonthlyPlanView.tsx` — primary dashboard, month navigation, plan table
- `App.tsx` — routes: /login, /register, /dashboard, /plan, /accounts, /categories
- `lib/api.ts` — getApiBaseUrl() helper, centralised base URL

---

## API Conventions

- Base URL: `/api/v1/`
- Auth: JWT Bearer token via HTTPBearer — `Authorization: Bearer <token>`
- All responses: JSON
- Amounts as strings (not floats) — NUMERIC serialised to string
- Dates: ISO 8601 (YYYY-MM-DD)
- Status codes: 200/201/204/400/401/403/404/422
- Logical deletes — never physically delete records (except TagAssignment)
- user_id always comes from the JWT token — never from the request body

---

## Design System (Phase 8)

**Colour palette — ocean/water theme:**
- Background: ocean-900 (#0f1923)
- Surface/cards: ocean-800 (#1a2a3a)
- Borders: ocean-700 (#2a3f52)
- Primary: sky-500 (#0ea5e9)
- Teal accent: teal-500 (#14b8a6)
- CTA/alert: coral-500 (#f43f5e)
- Text primary: slate-100
- Text muted: slate-400
- Success/positive remaining: #10b981
- Danger/overspent: #ef4444
- Pending/warning: #f59e0b

**Components:**
- Layout.tsx — nav bar, user display, logout, consistent padding
- All pages wrapped in Layout
- Modal forms with ocean-900/80 backdrop
- Consistent input styling: ocean-900 bg, ocean-700 border, sky-500 focus ring
- Coral-500 primary buttons

---

## Transaction Rules

- **expense** — money out, reduces category actual spend (cleared/reconciled only)
- **income** — money in, does not affect budget spend
- **transfer** — creates TWO linked transactions via parent_transaction_id
- **refund** — links to parent via parent_transaction_id, requires parent
- **pending** — excluded from budget actual spend by default
- **cleared** — counts toward actual spend
- **reconciled** — user confirmed against bank statement, counts toward actual spend

---

## Category Rules

- System categories (is_system=True) cannot be deleted — return 403
- System categories CAN be hidden (is_hidden=True)
- Hiding a parent cascades to direct children (one level only)
- Default list excludes hidden — pass ?include_hidden=true to see them
- 35 system categories seeded atomically on user registration
- Custom categories can be soft-deleted

---

## Authentication Strategy

**Current:** Email/password only, JWT Bearer tokens.

**Future (Phase 9):** Google OAuth via authlib.
Do not add google_id or install authlib until explicitly requested.

---

## Known Issues / Tech Debt

- O(n²) childrenOf() in CategoriesPage and MonthlyPlanView — fix with useMemo + Map
- No toast notification system — using window.alert for toggle failures
- React Query not wired up — using plain useEffect + useState
- StrictMode removed from main.tsx — re-add when stable

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
- ALLOWED_ORIGINS in Railway must match the Vercel URL exactly (no trailing slash)
- Run migrations against Supabase direct URL (port 5432), not pooled (port 6543)

---

## Running the Project

```bash
# Backend
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
# http://localhost:8000 · docs: http://localhost:8000/docs

# Frontend
cd frontend
npm run dev
# http://localhost:5173

# Tests
cd backend && python -m pytest tests/ -v
cd frontend && npm run test:run

# Migrations
cd backend
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic check

# Production migrations (Supabase direct URL)
DATABASE_URL="postgresql://postgres:PASSWORD@db.msframaqmymeunoqmtjr.supabase.co:5432/postgres" alembic upgrade head
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
│   │   ├── models/           SQLAlchemy ORM models
│   │   ├── schemas/          Pydantic request/response shapes
│   │   ├── routers/          API endpoint handlers
│   │   └── services/         auth, categories seeding, plan assembly
│   ├── migrations/           Alembic migration files
│   ├── Procfile              Railway start command
│   ├── runtime.txt           Python version for Railway
│   └── tests/                pytest test suite
├── frontend/
│   ├── src/
│   │   ├── pages/            full page components
│   │   ├── components/       reusable UI components
│   │   └── lib/              api.ts — getApiBaseUrl() helper
│   ├── vercel.json           SPA rewrite for Vercel
│   └── .env.example          VITE_API_URL template
└── docs/
    ├── PRD.md
    ├── TDD.md
    ├── PROJECT_PLAN.md
    └── architecture.png
```

---

## Phase 9 — Planned Features (Post-MVP)

### Interest Promotion Tracker
Track 0% interest promotions (Paypal BNPL, credit card balance transfers).

**Data model — `promotions` table:**
- name, account_id (FK), original_balance (NUMERIC 12,2)
- promotion_end_date (DATE), minimum_monthly_payment (NUMERIC 12,2)
- is_active (BOOLEAN)

**Features:** days remaining, required monthly payment, warning < 60 days,
progress bar showing % cleared.

### Open Banking / Bank Sync
TrueLayer or Plaid integration for automatic transaction import.
Requires OAuth per bank + webhook processing. Significant build.

### Google OAuth
authlib integration. Users table gets optional google_id column.

### Tags
Cross-cutting transaction labels via TagAssignment join table.

---

*Last updated: Phase 8 styling — April 2026*
