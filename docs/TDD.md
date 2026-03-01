# Tidal — Technical Design Document

**Version:** 0.1  
**Status:** Draft  
**Author:** Ginny Thomas  
**Last Updated:** March 2026

---

## 1. System Overview

Tidal is a monorepo containing two independent applications that communicate 
over HTTP via a REST API.

```
tidal/
├── backend/         Python + FastAPI + PostgreSQL
├── frontend/        React
└── docs/            Project documentation
```

The backend exposes a REST API. The frontend consumes it. Neither knows nor 
cares about the internal implementation of the other — they communicate 
exclusively through JSON over HTTP.

---

## 2. Technology Stack

### 2.1 Backend

| Technology | Version | Reason |
|------------|---------|--------|
| Python | 3.13.7 | Primary backend language. Strong typing support, excellent library ecosystem, high demand in Barcelona job market |
| FastAPI | Latest | Modern, fast, async-ready Python web framework. Auto-generates API documentation. Type-safe by design |
| PostgreSQL | 16 | Relational database. ACID compliant — essential for financial data integrity. Enforces relationships between entities |
| SQLAlchemy | 2.x | Python ORM (Object Relational Mapper). Lets us work with database records as Python objects rather than raw SQL |
| Alembic | Latest | Database migration tool. Manages changes to the database schema over time in a controlled, versioned way |
| Pydantic | v2 | Data validation library. Ensures data coming into and out of the API is always the correct shape and type |
| python-jose | Latest | JWT token handling for authentication |
| passlib | Latest | Password hashing — bcrypt algorithm |
| pytest | Latest | Testing framework |

### 2.2 Frontend

| Technology | Version | Reason |
|------------|---------|--------|
| React | 18+ | Component-based UI library. Industry standard. Builds on Ginny's existing JavaScript knowledge |
| TypeScript | Latest | Typed JavaScript. Catches errors at write time not run time. Industry standard for production React |
| Vite | Latest | Fast modern build tool for React. Replaces Create React App |
| React Query | Latest | Server state management. Handles API calls, caching, and loading states cleanly |
| React Router | Latest | Client-side routing between pages |
| Axios | Latest | HTTP client for API calls |
| Tailwind CSS | Latest | Utility-first CSS framework. Fast to build with, consistent results |

### 2.3 Infrastructure (Local Development)

| Tool | Purpose |
|------|---------|
| pyenv | Python version management |
| nvm | Node version management |
| venv | Python virtual environment isolation |
| Homebrew | Mac package management |

---

## 3. Data Model

### 3.1 Design Decisions

**Logical (soft) deletes throughout** — No data is ever physically deleted. Every 
entity has a `deleted_at` timestamp. Null means active. A timestamp means 
soft-deleted. This protects financial history, enables undo, and satisfies 
audit requirements.

**Exception: Reallocation records are never deleted** — Not even logically. 
They are a permanent audit trail. A reallocation can be reversed by creating 
an equal and opposite entry, but originals always remain.

**Exception: TagAssignment records are physically deleted** — Removing a tag 
from an entity is a genuine removal with no audit value. The tagged entity's 
own history is sufficient.

**All timestamps in UTC** — Stored in UTC, converted to user's local timezone 
for display. Avoids daylight saving edge cases.

**Currencies stored as strings** — ISO 4217 currency codes (GBP, EUR, USD). 
Amounts stored as NUMERIC(12,2) — never as floating point. Floating point 
arithmetic is unsafe for financial calculations.

### 3.2 Entity Relationship Overview

```
User
 ├── Account (many)
 ├── Category (many, hierarchical)
 ├── Budget (many)
 ├── Schedule (many)
 ├── Transaction (many)
 ├── Reallocation (many)
 └── Tag (many)

Account
 ├── Transaction (many)
 └── Schedule (many)

Category
 ├── Budget (many)
 ├── Transaction (many)
 ├── Schedule (many)
 └── Category (many, self-referential parent/child)

Budget
 ├── Reallocation as from_budget (many)
 └── Reallocation as to_budget (many)

Schedule
 └── Transaction (many, generated from schedule)

Transaction
 └── Transaction as refund (many, self-referential parent/child)

Tag
 └── TagAssignment (many, polymorphic — points to any entity)
```

### 3.3 Full Schema

```sql
-- Users
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    first_name        VARCHAR(100),
    last_name         VARCHAR(100),
    default_currency  VARCHAR(3) NOT NULL DEFAULT 'GBP',
    timezone          VARCHAR(50) NOT NULL DEFAULT 'Europe/London',
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at        TIMESTAMP WITH TIME ZONE,
    deleted_by        UUID REFERENCES users(id)
);

-- Accounts
CREATE TABLE accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id),
    name              VARCHAR(100) NOT NULL,
    account_type      VARCHAR(20) NOT NULL, 
                      -- checking/savings/credit_card/cash/mortgage/loan
    currency          VARCHAR(3) NOT NULL DEFAULT 'GBP',
    current_balance   NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_manual         BOOLEAN NOT NULL DEFAULT TRUE,
    institution       VARCHAR(100),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    note              TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at        TIMESTAMP WITH TIME ZONE,
    deleted_by        UUID REFERENCES users(id)
);

-- Categories
CREATE TABLE categories (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id),
    name              VARCHAR(100) NOT NULL,
    parent_category_id UUID REFERENCES categories(id),
    colour            VARCHAR(7),   -- hex colour e.g. #FF5733
    icon              VARCHAR(50),
    is_system         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at        TIMESTAMP WITH TIME ZONE,
    deleted_by        UUID REFERENCES users(id)
);

-- Budgets
CREATE TABLE budgets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id),
    category_id       UUID NOT NULL REFERENCES categories(id),
    amount            NUMERIC(12,2) NOT NULL,
    currency          VARCHAR(3) NOT NULL DEFAULT 'GBP',
    period_type       VARCHAR(20) NOT NULL, -- monthly/quarterly/annual
    period_start      DATE NOT NULL,
    period_end        DATE NOT NULL,
    is_rollover       BOOLEAN NOT NULL DEFAULT FALSE,
    note              TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at        TIMESTAMP WITH TIME ZONE,
    deleted_by        UUID REFERENCES users(id)
);

-- Schedules
CREATE TABLE schedules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    account_id          UUID NOT NULL REFERENCES accounts(id),
    category_id         UUID NOT NULL REFERENCES categories(id),
    name                VARCHAR(100) NOT NULL,
    payee               VARCHAR(100),
    amount              NUMERIC(12,2) NOT NULL,
    currency            VARCHAR(3) NOT NULL DEFAULT 'GBP',
    transaction_type    VARCHAR(20) NOT NULL, 
                        -- expense/income/transfer/refund
    frequency           VARCHAR(20) NOT NULL,
                        -- once/daily/weekly/monthly/
                        -- every_n_days/quarterly/annually
    interval            INTEGER,       -- e.g. 28 for every 28 days
    day_of_month        INTEGER,       -- e.g. 13 for 13th of month
    start_date          DATE NOT NULL,
    end_date            DATE,          -- null means runs forever
    auto_generate       BOOLEAN NOT NULL DEFAULT TRUE,
    last_generated_date DATE,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    note                TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at          TIMESTAMP WITH TIME ZONE,
    deleted_by          UUID REFERENCES users(id)
);

-- Transactions
CREATE TABLE transactions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id),
    account_id            UUID NOT NULL REFERENCES accounts(id),
    schedule_id           UUID REFERENCES schedules(id),
    parent_transaction_id UUID REFERENCES transactions(id),
    category_id           UUID NOT NULL REFERENCES categories(id),
    date                  DATE NOT NULL,
    payee                 VARCHAR(100),
    amount                NUMERIC(12,2) NOT NULL,
    currency              VARCHAR(3) NOT NULL DEFAULT 'GBP',
    exchange_rate         NUMERIC(10,6),
    transaction_type      VARCHAR(20) NOT NULL,
                          -- expense/income/transfer/refund
    status                VARCHAR(20) NOT NULL DEFAULT 'pending',
                          -- pending/cleared/reconciled
    note                  TEXT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at            TIMESTAMP WITH TIME ZONE,
    deleted_by            UUID REFERENCES users(id)
);

-- Reallocations (never deleted)
CREATE TABLE reallocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    from_budget_id  UUID NOT NULL REFERENCES budgets(id),
    to_budget_id    UUID NOT NULL REFERENCES budgets(id),
    amount          NUMERIC(12,2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'GBP',
    date            DATE NOT NULL,
    reason          TEXT NOT NULL,   -- mandatory, audit trail
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tags
CREATE TABLE tags (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    name        VARCHAR(50) NOT NULL,
    colour      VARCHAR(7),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at  TIMESTAMP WITH TIME ZONE,
    deleted_by  UUID REFERENCES users(id)
);

-- Tag Assignments (polymorphic join table, physically deleted)
CREATE TABLE tag_assignments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id       UUID NOT NULL REFERENCES tags(id),
    entity_type  VARCHAR(50) NOT NULL,
                 -- transaction/schedule/budget/account
    entity_id    UUID NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 4. API Design

### 4.1 Conventions

- Base URL: `/api/v1/`
- Authentication: JWT Bearer token in Authorization header
- All requests and responses: JSON
- Dates: ISO 8601 format (YYYY-MM-DD)
- Timestamps: ISO 8601 with timezone (YYYY-MM-DDTHH:MM:SSZ)
- Amounts: String representation of decimal (avoids float precision issues)
- HTTP status codes used correctly:
  - 200 OK — successful GET, PUT, PATCH
  - 201 Created — successful POST
  - 204 No Content — successful DELETE
  - 400 Bad Request — validation error
  - 401 Unauthorized — not logged in
  - 403 Forbidden — logged in but not allowed
  - 404 Not Found — resource doesn't exist
  - 422 Unprocessable Entity — request shape is wrong

### 4.2 Endpoints (MVP)

```
Auth
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout

Users
GET    /api/v1/users/me
PUT    /api/v1/users/me

Accounts
GET    /api/v1/accounts
POST   /api/v1/accounts
GET    /api/v1/accounts/{id}
PUT    /api/v1/accounts/{id}
DELETE /api/v1/accounts/{id}

Categories
GET    /api/v1/categories
POST   /api/v1/categories
GET    /api/v1/categories/{id}
PUT    /api/v1/categories/{id}
DELETE /api/v1/categories/{id}

Budgets
GET    /api/v1/budgets
POST   /api/v1/budgets
GET    /api/v1/budgets/{id}
PUT    /api/v1/budgets/{id}
DELETE /api/v1/budgets/{id}

Schedules
GET    /api/v1/schedules
POST   /api/v1/schedules
GET    /api/v1/schedules/{id}
PUT    /api/v1/schedules/{id}
DELETE /api/v1/schedules/{id}

Transactions
GET    /api/v1/transactions
POST   /api/v1/transactions
GET    /api/v1/transactions/{id}
PUT    /api/v1/transactions/{id}
DELETE /api/v1/transactions/{id}

Reallocations
GET    /api/v1/reallocations
POST   /api/v1/reallocations
GET    /api/v1/reallocations/{id}

Monthly Plan View
GET    /api/v1/plan/{year}/{month}
```

The `/plan/{year}/{month}` endpoint is the most important in the entire API. 
It returns everything needed to render the Monthly Plan View in a single call — 
budgets, scheduled transactions, actual transactions, and reallocation 
adjustments, all assembled server-side.

---

## 5. Authentication Flow

1. User registers → password is hashed with bcrypt → stored in database
2. User logs in → password checked against hash → JWT token issued
3. JWT token stored in browser (httpOnly cookie for security)
4. Every subsequent API request includes the token
5. Backend validates token on every request → extracts user_id
6. All database queries are scoped to that user_id → users can never 
   see each other's data

---

## 6. Project Structure

```
tidal/
├── backend/
│   ├── .python-version          pyenv Python version pin
│   ├── .venv/                   virtual environment (not in git)
│   ├── requirements.txt         Python dependencies
│   ├── alembic.ini              database migration config
│   ├── alembic/
│   │   └── versions/            migration files
│   ├── app/
│   │   ├── main.py              FastAPI app entry point
│   │   ├── config.py            environment configuration
│   │   ├── database.py          database connection
│   │   ├── models/              SQLAlchemy database models
│   │   │   ├── user.py
│   │   │   ├── account.py
│   │   │   ├── category.py
│   │   │   ├── budget.py
│   │   │   ├── schedule.py
│   │   │   ├── transaction.py
│   │   │   ├── reallocation.py
│   │   │   └── tag.py
│   │   ├── schemas/             Pydantic request/response shapes
│   │   │   ├── user.py
│   │   │   ├── account.py
│   │   │   └── ...
│   │   ├── routers/             API endpoint definitions
│   │   │   ├── auth.py
│   │   │   ├── accounts.py
│   │   │   └── ...
│   │   ├── services/            business logic layer
│   │   │   ├── auth.py
│   │   │   ├── plan.py          monthly plan view assembly
│   │   │   └── ...
│   │   └── dependencies.py      shared FastAPI dependencies
│   └── tests/
│       ├── conftest.py
│       └── test_*.py
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx             React entry point
│       ├── App.tsx              root component + routing
│       ├── api/                 API call functions
│       ├── components/          reusable UI components
│       ├── pages/               full page components
│       │   ├── Login.tsx
│       │   ├── Register.tsx
│       │   └── MonthlyPlan.tsx  primary view
│       ├── hooks/               custom React hooks
│       └── types/               TypeScript type definitions
│
└── docs/
    ├── PRD.md                   Product Requirements Document
    └── TDD.md                   Technical Design Document
```

---

## 7. Key Engineering Decisions

### Why FastAPI over Flask or Django?

Flask is too minimal — we'd spend time building infrastructure Django 
provides. Django is too opinionated and heavy for an API-only backend. 
FastAPI hits the sweet spot: modern, fast, built-in data validation via 
Pydantic, automatic API documentation, and async support for when we 
need it later.

### Why SQLAlchemy over raw SQL?

Two reasons. First, it lets us work with Python objects rather than 
writing SQL strings — safer and more maintainable. Second, it pairs with 
Alembic for database migrations, which means schema changes are versioned 
and reproducible across environments.

### Why UUIDs over integer IDs?

Integer IDs are sequential and predictable — a user could guess 
`/transactions/1001` and try to access someone else's data. UUIDs are 
random and unguessable. Combined with our user_id scoping on all queries, 
this provides defence in depth.

### Why NUMERIC not FLOAT for amounts?

Floating point arithmetic is famously imprecise. `0.1 + 0.2` in floating 
point does not equal `0.3`. For financial calculations this is 
unacceptable. NUMERIC(12,2) stores exact decimal values with no 
floating point rounding errors.

### Why logical deletes?

Financial history must never be destroyed. A transaction from six months 
ago that is "deleted" by a user still needs to be accounted for in 
historical views and audit trails. Logical deletes preserve history while 
hiding records from active views.

---

## 8. Development Phases

### Phase 1 — MVP (current)
Everything defined in PRD section 5.1

### Phase 2 — Enrichment
Tags, split transactions, reporting, trend analysis, data export

### Phase 3 — Growth
Bank sync via open banking, mobile app, household sharing, 
notifications

---

*This document will be updated as technical decisions evolve. 
All significant changes should be noted with version and date.*
