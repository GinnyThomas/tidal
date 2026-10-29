# CLAUDE.md — Project Context for Claude Code

This file is read automatically by Claude Code on startup.
It provides context about the project, the developer, and how we work together.

---

## The Developer

**Name:** Ginny Thomas
**Background:** Full Stack Engineer, 4 years production Scala/Play at HMRC via Capgemini.
Former MSc Family Nurse Practitioner. Completed Makers Academy bootcamp.
**Relocating:** Barcelona, June 2026. Actively job hunting.
**Learning goals:** Understand every decision. Explain confidently in interviews.

---

## How We Work Together

- Explain what and why before writing code
- TDD throughout: Red → Green → Refactor
- pytest for backend, Vitest + RTL for frontend
- Clear over clever. Type hints everywhere.
- Flag anything needing revisiting later

---

## The Project

**Name:** Tidal — Multi-currency personal finance tracker
**Live:** https://tidal-vert.vercel.app (demo@tidal.app / TidalDemo2026!)
**Backend:** https://tidal-production.up.railway.app
**Repo:** github.com/GinnyThomas/tidal

---

## Tech Stack

**Backend:** Python 3.13 · FastAPI · PostgreSQL 16 · SQLAlchemy 2.x · Alembic · Pydantic v2
**Frontend:** React 19 · TypeScript · Vite · React Router v7 · Tailwind CSS v4
**Infra:** Railway (backend) · Vercel (frontend) · Supabase (PostgreSQL)

---

## All Phases Complete — 700 Tests

**230 backend · 470 frontend · 700 total**

- ✅ Phase 0-7: Walking skeleton through Reallocation
- ✅ Phase 8: Styling, mobile, demo account, annual view, drill-downs
- ✅ Phase 9: Budgets (annual defaults, monthly overrides, Set Pattern, groups)
- ✅ Phase 10: Promotions, cash flow, opening balances, transfer editing, UX polish
- ✅ Phase 11: Category groups, credit card balances, scheduled transfers, exports,
               payee search, schedule category filter, batch overrides, Add now
- ✅ Split transactions (one transaction → multiple category allocations)
- ✅ CSV import (bank templates, dedup, category assignment, convert to transfer)
- ✅ Year-end rollover (copy budgets to next year, carry closing → opening balance)
- ✅ Password reset (forgot-password email via Resend, single-use hashed tokens)

---

## Models (13 tables)

- `users` — email(lower) · bcrypt · JWT · token_version (JWT `ver` claim; bump = revoke all sessions)
- `accounts` — type · currency · opening_balance · calculated dynamically
- `categories` — hierarchy · is_system · is_hidden · is_income · **group**
- `transactions` — 4 types · nullable category · promotion_id · is_split · dedup_hash · external_id
- `transaction_splits` — category · promotion · amount · note (sum must equal parent, enforced in router)
- `schedules` — recurrence · group · next_occurrence · active · **schedule_type** · from/to accounts
- `reallocations` — immutable · reason required
- `budgets` — default_amount · year · group · notes · unique(user,cat,year)
- `budget_overrides` — month · amount · batch upsert endpoint
- `promotions` — type · dates · interest_rate · is_active · urgency computed
- `group_opening_balances` — group · year · opening_balance · currency
- `csv_mappings` — saved column mapping per (user, account) · mapping_json
- `password_reset_tokens` — token_hash (SHA-256, raw token only in email) · expires_at · used_at · max one row per user

---

## Routers (11)

`/auth` · `/accounts` · `/categories` · `/transactions` · `/schedules`
`/reallocations` · `/plan` · `/budgets` · `/promotions` · `/opening_balances`
`/csv-mappings`

Notable `/auth` sub-routes: `POST /forgot-password` (always 202) · `POST /reset-password`
Notable `/budgets` sub-route: `POST /copy-year`
Notable `/transactions` sub-routes: `POST /transfer` · `POST /import` · `POST /{id}/convert-to-transfer`

---

## Key Features

**Budget Groups (UK / España / General):**
- `group` field on budgets, schedules, AND categories
- Group resolution: budget group → schedule group → category group → General
- Plan view, Annual view, Budgets, Schedules all section by group
- GROUP_ORDER = ['UK', 'España', 'General'] in `lib/budgetGroups.ts`

**Year-end Rollover:**
- Budgets page, empty year: "Copy budgets from {year-1}" → `POST /budgets/copy-year`
  (`include_overrides` checkbox, off by default). Idempotent: categories already
  budgeted in the target year, or soft-deleted, are skipped and counted;
  a concurrent copy losing the unique-constraint race gets a 409
- Annual view, group with no opening balance: "Use {year-1} closing" fetches the
  previous year's plan (unfiltered) on click and saves its December closing. Flagged as an
  estimate while the previous year isn't over (closing includes planned amounts)
- Closing balance maths lives in `lib/cashFlow.ts` → `aggregateByCategory()` +
  `computeClosingBalances()`; plan response types in `lib/planTypes.ts`
- `/plan?group=` filters **budgets only** (schedules/transactions from all groups
  still arrive), so a filtered Annual view's cash flow filters rows client-side

**Password Reset:**
- Login → "Forgot password?" → `/forgot-password` → email link → `/reset-password?token=…`
  → back to `/login` with a "Password updated" banner (router state `passwordReset`)
- Same 202 response for known/unknown emails. The route does no DB work: lookup,
  token INSERT and email all run in a `BackgroundTasks` task (own session via
  `get_session_factory`), so response time doesn't leak whether the account exists
- Tokens: 30 min expiry, single use; a new request replaces the user's previous token.
  Redeeming is one atomic `UPDATE … WHERE used_at IS NULL RETURNING` (race-safe)
- Successful reset bumps `users.token_version` → every existing JWT gets 401,
  including on `/refresh`. Tokens without `ver` (pre-versioning) count as 0
- `services/email.py` → Resend HTTP API (Railway blocks SMTP). No `RESEND_API_KEY`:
  localhost frontend → email logged to console; deployed → error logged, never the link
- Link base = `settings.frontend_base_url`: `FRONTEND_URL`, else first `ALLOWED_ORIGINS`
  entry, trailing slash stripped. Railway env: `RESEND_API_KEY`
- Logs (Railway): "no active account" (nothing sent), "sending reset email",
  "Email … sent (Resend id …)", or an ERROR. Search `reset`, not just `email`
- LoginPage shows "Invalid Credentials" only for a 401, "valid email" for a 422; other failures (e.g. DB
  unreachable → 500) show a generic error

**Cash Flow (Annual View):**
- Opening balance per group per year (editable inline)
- Closing balance = opening + income - expenses rolling monthly
- Income determined by `is_income` flag on Category
- Expenses/Income shown in separate sub-sections within each group
- Default: cash flow ON

**CSV Import (`ImportCsvPage.tsx`):**
- Bank templates in `lib/csvTemplates/` — Monzo, Virgin Money, Santander España
  auto-detected from headers; Barclays exists but `verified: false` (excluded from
  auto-detection until checked against a real export)
- Unrecognised files → manual column mapping, saved per account via `/csv-mappings`
- Client-side dedup (definite / possible duplicates) in review step; server-side
  dedup via `dedup_hash` + `external_id` as final safety net
- Category assignment during review (per row or bulk-apply to selected rows);
  unknown/unowned category_ids → 404 listing all bad ids
- "Convert to Transfer" turns a mis-classified imported row into a transfer leg,
  keeping its dedup history
- Robustness: malformed rows skipped (not whole file), Unicode minus handled,
  payees > 100 chars truncated with full text in note, Santander "PAGO MOVIL EN" /
  "COMPRA" prefixes stripped, currency follows the selected account
- Santander match requires `Value date` + `Balance` columns — the narrower export
  variant falls through to manual mapping (deliberate: avoids false positives)
- `TODO(refunds)`: no refund signal from banks, so all positive amounts import as
  income — pinned by `test_import_positive_amount_classified_as_income_pending_refund_refactor`

**Split Transactions:**
- `is_split` on transaction + `transaction_splits` rows (category · promotion · amount)
- Split amounts must sum to transaction total (router validation)
- Full UI in `AddTransactionForm.tsx`; plan service allocates actuals per split

**Account Balances:**
- `calculated_balance` = opening + transactions (cleared/reconciled only)
- Credit cards INVERTED: expenses increase balance (more owed), payments decrease
- Clicking account card → navigates to filtered transactions

**Scheduled Transfers:**
- `schedule_type`: "regular" or "transfer"
- Transfer schedules have from_account_id + to_account_id, no category
- "Add now" button creates immediate transaction from any schedule

**Budget Override UX:**
- Click month cell → inline edit with amber highlight for pending changes
- "Save all" → batch POST to `/overrides/batch` (one request, no page jump)
- Set Pattern: Monthly / Quarterly / Annual / Clear all
- Keyboard navigation: Enter moves to next month

**Export:**
- "Download PDF" → window.print() with print CSS (white background, nav hidden)
- "Export CSV" → RFC4180 compliant, formula injection prevention, group sections preserved
- Both on Annual view and Dashboard

**Search & Filter:**
- Payee search on Transactions page (client-side)
- Account filter pre-selects when opening Add Transaction/Transfer
- Account balance shown below account filter when active
- Schedule filter by category_id from URL params
- Status filter readable from URL on Transactions page
- All category_id URL params URL-encoded via URLSearchParams

**Category Dropdowns:**
- `buildCategoryOptions()` in `lib/categories.ts` — parent → children hierarchy
- "— No category —" option for all transaction types (category optional)
- Alphabetical within each level

---

## Transaction Rules

- **expense/income/refund** — category optional (was required, now nullable)
- **transfer** — no category (category_id = NULL), creates two linked rows
- **pending** — excluded from budget actual spend
- **cleared/reconciled** — count toward actual spend
- Credit card accounts: expenses increase balance, payments decrease
- Transfer rows: disabled Edit button replaced with AddTransferForm edit mode

---

## Schedule Rules

- `schedule_type`: "regular" (has category) or "transfer" (has from/to accounts)
- `next_occurrence` computed via `get_next_occurrence()` in plan service
- 0-based month arithmetic to avoid off-by-one errors
- "Add now" button pre-populates AddTransactionForm, scrolls to form
- `category_is_income` included in ScheduleResponse for correct income/expense type

---

## Plan View Assembly

planned = schedule amounts + budget amounts per category per month:
1. Schedules: amount × occurrences, grouped by category
2. Budgets: override or default_amount, filtered by group
3. Reallocations: adjustments
4. Actual: cleared+reconciled transactions
5. Pending: pending transactions
6. Group resolution: budget group → schedule group → category group → General

---

## Frontend Libraries

- `lib/formatting.ts` — `fmtCurrency()`, `fmtAmount()` (shared Intl.NumberFormat)
- `lib/budgetGroups.ts` — `GROUP_ORDER`
- `lib/categories.ts` — `sortCategoriesByName()`, `buildCategoryOptions()`
- `lib/currencies.ts` — `CURRENCIES` dropdown list
- `lib/cashFlow.ts` — `aggregateByCategory()`, `computeClosingBalances()` (Annual view cash flow)
- `lib/planTypes.ts` — `AnnualPlan` / `MonthlyPlan` / `PlanRow` response types
- `lib/csvExport.ts` — `escapeCsvCell()`, `buildCsvContent()`, `downloadCsv()`
- `lib/annualPlanCache.ts` — session cache, invalidated on mutations/logout
- `lib/axiosConfig.ts` — 401 handler + JWT auto-refresh (< 15 min expiry)
- `lib/api.ts` — `getApiBaseUrl()`
- `lib/csvTemplates.ts` + `lib/csvTemplates/` — bank template registry, `detectTemplate()`
- `lib/csvParsing.ts` — shared parsing for mapping preview + import (must stay identical: feeds dedup hash)
- `lib/dedupHash.ts` — client-side dedup hash, mirrors backend `compute_dedup_hash()`

---

## Important Reminders

- sa.Uuid(as_uuid=True) in all migrations
- NOT NULL columns need server_default in migration
- New tables: `op.execute('ALTER TABLE public.x ENABLE ROW LEVEL SECURITY')` in the
  creating migration (Supabase advisor `rls_disabled_in_public`). The Data API roles
  (anon/authenticated) are locked out by `36f77bf75b7b` + `fe459eb10289` (object grants,
  default privileges and schema USAGE, also revoked from PUBLIC); the app is the owner, so RLS doesn't touch
  it. CI (`backend-tests.yml`) runs `tests/test_migrations_rls.py` against Postgres and
  fails on any table without RLS. Locally:
  `POSTGRES_TEST_URL=postgresql://localhost/tidal_migrations_test pytest tests/test_migrations_rls.py`
  (refuses non-local URLs and databases without "test" in the name: it drops the schema)
- ALLOWED_ORIGINS in Railway: no trailing slash
- Migrations: Supabase **session pooler** (`postgres.<ref>@aws-0-eu-west-1.pooler.supabase.com:5432`);
  the direct `db.*` host is IPv6-only and unreachable from home. App uses pooled :6543
- Run migrations BEFORE merging code that needs them — Railway auto-deploys on merge
- Changing the Supabase DB password → also update `DATABASE_URL` in Railway (then Deploy).
  Check with `GET /api/v1/health/db`
- Logging: `app/logging_config.py` makes `app.*` INFO visible (uvicorn only configures its own loggers)
- `from datetime import date as date_` — Pydantic v2 shadowing
- `group` reserved in PostgreSQL — quote as `"group"` in raw SQL
- Supabase "No rows returned" = UPDATE/DELETE succeeded
- Railway free tier cold starts ~30s
- JWT auto-refresh triggers < 15 minutes remaining
- Credit card balance: expenses increase, income/payments decrease
- URL-encode category_id params via `new URLSearchParams({ category_id: id })`
- category_id nullable on all transaction types (including expense/income)
- Transfer schedules: require from/to accounts, no category

---

## Known Tech Debt

- Annual view: 12 separate plan API calls (N×12 queries)
- N+1 on list_accounts balance calculation
- sessionStorage for annual cache (in-memory only)
- React Query not wired up
- CSV import refund detection (see `TODO(refunds)` above)
- Annual CSV export writes hardcoded totals, not live `=SUM()` formulas
  (needs a careful exception in `escapeCsvCell()` formula-injection protection)
- Currency consolidation (exchange_rate exists, no conversion logic)
- Open Banking / bank sync
- Google OAuth
- Password reset: no domain verified with Resend yet, so emails only reach the Resend
  account owner; no rate limiting on `/forgot-password`
- `/change-password` doesn't bump `token_version` (other sessions stay logged in);
  doing so needs the endpoint to return a fresh token for the current session
- Per-schedule actual spend tracking

---

## Running the Project

```bash
# Backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload

# Frontend
cd frontend && npm run dev

# Tests
cd backend && python -m pytest tests/ -v
cd frontend && npm run test:run

# Production migrations (session pooler — see Important Reminders)
DATABASE_URL='postgresql://postgres.msframaqmymeunoqmtjr:PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' alembic upgrade head

# Refresh demo
cd backend && ./scripts/refresh_demo.sh
```

---

*Last updated: October 2026 — 700 tests · Live at tidal-vert.vercel.app*
