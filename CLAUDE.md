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
- PostgreSQL 16
- SQLAlchemy 2.x (ORM)
- Alembic (migrations)
- Pydantic v2 (validation)
- pytest + pytest-asyncio + httpx + factory-boy (testing)

**Frontend:**
- React 19 + TypeScript
- Vite
- React Query (not yet wired up — planned for Phase 6)
- React Router v7
- Tailwind CSS (not yet wired up — planned for Phase 8 polish)
- Vitest + React Testing Library (testing)

---

## Current Phase

**Phase 4 — Transactions (in progress)**

Phases complete:
- ✅ Phase 0: Walking skeleton (health endpoint, React frontend connected)
- ✅ Phase 1: Authentication (register, login, JWT, ProtectedRoute, Alembic)
- ✅ Phase 2: Accounts (CRUD, soft delete, frontend with add form)
- ✅ Phase 3: Categories (hierarchical, system seeding, hide/unhide, frontend)

Phases remaining:
- 🔄 Phase 4: Transactions (expense/income/transfer/refund, pending/cleared/reconciled)
- ⏳ Phase 5: Schedules (recurrence engine, auto-generate pending transactions)
- ⏳ Phase 6: Monthly Plan View (primary dashboard, plan vs actual)
- ⏳ Phase 7: Reallocation (budget adjustments, permanent audit trail)
- ⏳ Phase 8: Polish & Deploy (Railway + Vercel + Supabase, demo account)

---

## Data Model Summary

Eight core entities — all use logical (soft) deletes via deleted_at timestamp,
except Reallocation (never deleted) and TagAssignment (physically deleted).

- **User** — owns everything, has default_currency and timezone
- **Account** — where money lives (checking/savings/credit_card/cash/mortgage/loan)
- **Category** — hierarchical (parent_category_id for subcategories), is_system/is_hidden flags
- **Budget** — planned spend per category per period, optional rollover
- **Schedule** — recurring transaction rules, generates pending transactions
- **Transaction** — what actually happened (expense/income/transfer/refund)
- **Reallocation** — permanent audit trail of budget adjustments with mandatory reason
- **Tag** — cross-cutting labels via TagAssignment join table

**Key data decisions:**
- UUIDs not integer IDs (security — unguessable)
- NUMERIC(12,2) not FLOAT for amounts (financial precision)
- All timestamps in UTC
- Currencies as ISO 4217 strings (GBP, EUR, USD)
- Pending transactions excluded from budget actual spend by default
- Budget toggle to include pending transactions (planned for Phase 6)
- Refunds reduce category spend via parent_transaction_id link
- Transfers create TWO linked transactions via parent_transaction_id

---

## What's Built So Far

**Backend (29 tests passing):**
- `app/models/user.py` — User model, bcrypt password hash, soft delete
- `app/models/account.py` — Account model, NUMERIC balance, FK to users
- `app/models/category.py` — Category model, self-referential FK, is_system, is_hidden
- `app/schemas/` — Pydantic v2 schemas for all entities
- `app/services/auth.py` — bcrypt hashing, JWT creation, get_current_user dependency
- `app/services/categories.py` — seed_default_categories (35 categories, atomic with user creation)
- `app/routers/auth.py` — register (seeds categories atomically), login
- `app/routers/accounts.py` — full CRUD, soft delete, user-scoped
- `app/routers/categories.py` — full CRUD, toggle-visibility with child cascade, system protection
- `migrations/` — Alembic migrations for users, accounts, categories, is_hidden

**Frontend (44 tests passing):**
- `LoginPage.tsx` — JWT auth, localStorage token storage
- `RegisterPage.tsx` — register + auto-login, password confirmation
- `ProtectedRoute.tsx` — redirects to /login if no token
- `AccountsPage.tsx` — list/empty/error states, add account form
- `AddAccountForm.tsx` — account creation with JWT auth
- `CategoriesPage.tsx` — hierarchical display, hide/unhide toggle, add form
- `AddCategoryForm.tsx` — category creation with parent dropdown
- `App.tsx` — routes: /login, /register, /dashboard (AccountsPage), /categories

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

## Authentication Strategy

**Current:** Email/password only, JWT Bearer tokens.

**Future (post-MVP):** Add Google OAuth alongside email/password using **authlib**.
A User record exists independently of how they authenticated — the users table
will get an optional `google_id` column and a `POST /api/v1/auth/google` endpoint.
Do not add `google_id` or install authlib until explicitly requested.

---

## Transaction Rules (Phase 4)

- **expense** — money out, reduces category actual spend (if cleared/reconciled)
- **income** — money in, does not affect budget spend
- **transfer** — creates TWO linked transactions (debit on source, credit on destination)
  linked via parent_transaction_id
- **refund** — reduces net spend in original category, links to parent via
  parent_transaction_id
- **pending** — transaction occurred but not yet cleared by bank; excluded from
  budget actual spend by default
- **cleared** — bank has processed it; counts toward actual spend
- **reconciled** — user has confirmed against bank statement; counts toward actual spend
- schedule_id is nullable in Phase 4 — Phase 5 wires up the schedule relationship

---

## Category Rules

- System categories (is_system=True) cannot be deleted — return 403
- System categories CAN be hidden (is_hidden=True)
- Hiding a parent cascades to direct children (one level only)
- Default list excludes hidden categories — pass ?include_hidden=true to see them
- 34 system categories are seeded atomically on user registration
- Custom categories can be deleted (soft delete via deleted_at)

---

## Known Issues / Tech Debt

- The O(n²) childrenOf() in CategoriesPage — fix in Phase 8 with useMemo + Map
- No toast notification system — toggle failures use window.alert for now
- React Query not yet wired up — using plain useEffect + useState for data fetching
- StrictMode removed from main.tsx during Phase 0 — re-add in Phase 8

---

## Project Structure

```
tidal/
├── backend/
│   ├── app/
│   │   ├── main.py           FastAPI entry point, router registration
│   │   ├── config.py         pydantic-settings, env vars
│   │   ├── database.py       SQLAlchemy engine, SessionLocal, get_db
│   │   ├── dependencies.py   shared FastAPI dependencies
│   │   ├── models/           SQLAlchemy ORM models
│   │   ├── schemas/          Pydantic request/response shapes
│   │   ├── routers/          API endpoint handlers
│   │   └── services/         business logic (auth, categories seeding)
│   ├── migrations/           Alembic migration files
│   └── tests/                pytest test suite
├── frontend/
│   └── src/
│       ├── pages/            full page components
│       ├── components/       reusable UI components
│       ├── api/              API call functions (planned)
│       ├── hooks/            custom React hooks (planned)
│       └── types/            TypeScript type definitions (planned)
└── docs/
    ├── PRD.md
    ├── TDD.md
    ├── PROJECT_PLAN.md
    └── architecture.png
```

---

## Important Reminders

- Never store passwords in plain text — always bcrypt
- Never commit .env files — .env.example only
- Always scope database queries to the authenticated user_id
- Pending transactions excluded from budget actual spend by default
- Reallocation records are never deleted — not even soft deleted
- Financial amounts always use NUMERIC not FLOAT
- sa.Uuid() in migrations must always be sa.Uuid(as_uuid=True)
- Alembic migrations: always fix sa.Uuid() → sa.Uuid(as_uuid=True) before applying
- Adding NOT NULL columns to existing tables requires server_default in the migration

---

## Running the Project

```bash
# Backend
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
# Runs on http://localhost:8000
# API docs: http://localhost:8000/docs

# Frontend
cd frontend
npm run dev
# Runs on http://localhost:5173

# Backend tests
cd backend && source .venv/bin/activate
python -m pytest tests/ -v

# Frontend tests
cd frontend
npm run test:run

# Database migrations
cd backend && source .venv/bin/activate
alembic upgrade head                                    # apply all migrations
alembic revision --autogenerate -m "description"       # generate new migration
alembic check                                          # verify DB matches models
```

---

*Last updated: Phase 4 starting point — April 2026*