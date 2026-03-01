# CLAUDE.md — Project Context for Claude Code

This file is read automatically by Claude Code on startup.
It provides context about the project, the developer, and how we work together.

---

## The Developer

**Name:** Ginny Thomas  
**Background:** Full Stack Engineer with 4 years production experience (Scala/Play 
Framework at HMRC via Capgemini). Former MSc Family Nurse Practitioner. 
Completed Makers Academy bootcamp.  
**Current situation:** Transitioning to Barcelona. Actively job hunting in a 
tough market. Building this project to strengthen GitHub profile and demonstrate 
Python + React skills.  
**Experience level:** Mid-level engineer with strong real-world experience but 
limited formal CS education. No prior experience architecting and building an 
app from scratch.  
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
- React 18 + TypeScript
- Vite
- React Query
- React Router
- Tailwind CSS
- Vitest + React Testing Library (testing)

---

## Data Model Summary

Eight core entities — all use logical (soft) deletes via deleted_at timestamp,
except Reallocation (never deleted) and TagAssignment (physically deleted).

- **User** — owns everything, has default_currency and timezone
- **Account** — where money lives (checking/savings/credit_card/cash/mortgage/loan)
- **Category** — hierarchical (parent_category_id for subcategories)
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
- Pending transactions excluded from budget actual spend calculations
- Refunds reduce category spend via parent_transaction_id link

---

## Project Structure

```
tidal/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI entry point
│   │   ├── config.py        environment configuration
│   │   ├── database.py      database connection
│   │   ├── dependencies.py  shared FastAPI dependencies
│   │   ├── models/          SQLAlchemy models
│   │   ├── schemas/         Pydantic request/response shapes
│   │   ├── routers/         API endpoints
│   │   └── services/        business logic
│   └── tests/
├── frontend/
│   └── src/
│       ├── api/             API call functions
│       ├── components/      reusable UI components
│       ├── pages/           full page components
│       ├── hooks/           custom React hooks
│       └── types/           TypeScript type definitions
└── docs/
    ├── PRD.md
    ├── TDD.md
    └── PROJECT_PLAN.md
```

---

## API Conventions

- Base URL: `/api/v1/`
- Auth: JWT Bearer token
- All responses: JSON
- Amounts as strings (not floats)
- Dates: ISO 8601 (YYYY-MM-DD)
- Status codes used correctly (200/201/204/400/401/403/404/422)
- Logical deletes — never physically delete records (except TagAssignment)

---

## Current Phase

**Phase 0 — Foundation (Walking Skeleton)**

Goal: prove all pieces connect end to end.

- Backend: GET /api/v1/health returns `{"status": "ok", "app": "Tidal"}`
- Frontend: React page that calls the health endpoint and displays the response
- Database: connected and reachable
- Tests: pytest passes, vitest passes

Do not build beyond this scope until Phase 0 is complete and confirmed working.

---

## Authentication Strategy

**Phase 1:** Email/password only, using JWT Bearer tokens (already in the tech stack).

**Phase 2:** Add Google OAuth alongside email/password — not instead of it.

**Key design decision:** A `User` record exists independently of how they authenticated.
This means the users table gets an optional `google_id` column in Phase 2, and a new
`POST /api/v1/auth/google` endpoint handles the OAuth callback. The same `User` row
can have both a hashed password and a `google_id` — they are just two ways into the
same account.

The library to use for Google OAuth in FastAPI is **authlib** (lighter and more
actively maintained than python-social-auth).

Do not add `google_id` to the User model or install authlib until Phase 2.

---

## Important Reminders

- Never store passwords in plain text — always bcrypt
- Never commit .env files — .env.example only
- Always scope database queries to the authenticated user_id
- Pending transactions never count toward budget actual spend
- Reallocation records are never deleted — not even soft deleted
- Financial amounts always use NUMERIC not FLOAT

---

*This file should be updated as the project evolves.*
*Current version reflects Phase 0 starting point.*
