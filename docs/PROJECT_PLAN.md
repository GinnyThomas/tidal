# Tidal — Project Plan & Milestones

**Version:** 0.2  
**Status:** Draft  
**Author:** Ginny Thomas  
**Last Updated:** March 2026  
**Changed:** Added TDD as core development practice throughout

---

## Guiding Principles

- **Test Driven Development (TDD) throughout** — tests are written before 
  code, not after. Every feature follows Red → Green → Refactor. 
  This is not optional — it is how we build.

- **Vertical slices over horizontal layers** — we build one complete feature 
  end to end (backend + frontend) before moving to the next, rather than 
  building all backend first then all frontend. This means something 
  always works.

- **Walking skeleton first** — the first milestone is the thinnest possible 
  version of the full system that runs end to end. No features, just 
  proof that all the pieces connect.

- **Commit early, commit often** — every meaningful chunk of work gets its 
  own commit with a clear message. Your GitHub contribution graph should 
  tell the story of the project.

- **Tests as we go** — not a testing phase at the end. Each feature gets 
  basic tests when it's built.

- **Document decisions** — PRD and TDD are living documents, updated as 
  things change.

---

---

## TDD Cycle — Red, Green, Refactor

Every single feature follows this cycle without exception:

```
RED      → Write a test for behaviour that doesn't exist yet.
           Run it. It fails. This is correct and expected.

GREEN    → Write the minimum code to make the test pass.
           Not elegant. Not complete. Just enough.

REFACTOR → Clean up the code knowing the test will catch regressions.
           Then commit.
```

### Backend TDD Pattern (pytest)

```python
# 1. Write the test FIRST
def test_create_account_returns_201(client, auth_headers):
    response = client.post("/api/v1/accounts",
        json={"name": "HSBC Current",
              "account_type": "checking",
              "currency": "GBP"},
        headers=auth_headers
    )
    assert response.status_code == 201
    assert response.json()["name"] == "HSBC Current"

# 2. Run pytest → RED (endpoint doesn't exist yet)
# 3. Write the endpoint
# 4. Run pytest → GREEN
# 5. Refactor if needed
# 6. Commit
```

### Frontend TDD Pattern (Vitest + React Testing Library)

```typescript
// 1. Write the test FIRST
it('shows account name after creation', async () => {
  render(<AccountsPage />)
  await userEvent.click(screen.getByText('Add Account'))
  await userEvent.type(screen.getByLabelText('Account Name'), 'HSBC Current')
  await userEvent.click(screen.getByText('Save'))
  expect(await screen.findByText('HSBC Current')).toBeInTheDocument()
})

// 2. Run vitest → RED
// 3. Build the component
// 4. Run vitest → GREEN
// 5. Refactor
// 6. Commit
```

### The golden rule — test behaviour, not implementation

```
✅ "a user who is not logged in gets a 401 response"
✅ "a pending transaction does not count toward budget actual spend"
✅ "a reallocation without a reason cannot be submitted"

❌ "the function calls the database with these exact parameters"
❌ "the component's internal state changes when clicked"
```

The first set tests what the system *does*.
The second set tests how it's *built* — and breaks whenever
you refactor even if nothing changed for the user.

---

## Phase 0 — Foundation
**Goal:** Everything is set up, connected, and the project exists publicly  
**Status:** 🟡 In Progress

### Milestones

- [x] Development environment installed (Python, Node, PostgreSQL, Git)
- [x] GitHub repo created and public
- [x] Monorepo structure created (backend/, frontend/, docs/)
- [x] PRD written and committed
- [x] TDD written and committed
- [x] Project plan written and committed
- [ ] Backend virtual environment configured
- [ ] Backend dependencies installed (FastAPI, SQLAlchemy, pytest etc.)
- [ ] pytest configured and first passing test written
- [ ] Database created in PostgreSQL
- [ ] Backend walking skeleton running (single endpoint returns 200 OK)
- [ ] Frontend scaffolded with Vite + React + TypeScript
- [ ] Vitest and React Testing Library configured
- [ ] First passing frontend test written
- [ ] Frontend connects to backend (calls the walking skeleton endpoint)
- [ ] Both run simultaneously in development

**Exit criteria:** `npm run dev` starts the frontend,
`uvicorn app.main:app` starts the backend,
frontend successfully calls backend and displays a response.
`pytest` runs and passes. `npm run test` runs and passes.

---

## Phase 1 — Authentication
**Goal:** Users can register, log in, and log out securely  
**Depends on:** Phase 0 complete

### Milestones

**Backend**
- [ ] User model and database table
- [ ] Password hashing with bcrypt
- [ ] Register endpoint (`POST /api/v1/auth/register`)
- [ ] Login endpoint (`POST /api/v1/auth/login`)
- [ ] JWT token generation and validation
- [ ] Auth middleware — protects all future endpoints
- [ ] Get current user endpoint (`GET /api/v1/users/me`)
- [ ] Tests for auth endpoints

**Frontend**
- [ ] React Router set up with protected routes
- [ ] Register page
- [ ] Login page
- [ ] Auth state management (store and access JWT token)
- [ ] Redirect unauthenticated users to login
- [ ] Logout functionality
- [ ] Basic layout shell (header, navigation placeholder)

**Exit criteria:** A user can register, log in, see their name displayed, 
and log out. An unauthenticated request to a protected endpoint returns 401.

---

## Phase 2 — Accounts
**Goal:** Users can create and manage financial accounts  
**Depends on:** Phase 1 complete

### Milestones

**Backend**
- [ ] Account model and database table
- [ ] Alembic migration for accounts table
- [ ] All account endpoints (GET list, POST, GET by id, PUT, DELETE)
- [ ] Soft delete implementation
- [ ] All queries scoped to authenticated user
- [ ] Tests for account endpoints

**Frontend**
- [ ] Accounts list page
- [ ] Create account form (name, type, currency, opening balance)
- [ ] Edit account
- [ ] Deactivate account
- [ ] Account type icons/labels

**Exit criteria:** A user can create a GBP checking account, 
a EUR cash account, and a credit card account. 
They can edit and deactivate them. 
They cannot see another user's accounts.

---

## Phase 3 — Categories & Budgets
**Goal:** Users can define spending categories and set monthly budgets  
**Depends on:** Phase 2 complete

### Milestones

**Backend**
- [ ] Category model with parent/child hierarchy
- [ ] Default system categories seeded on user registration
- [ ] All category endpoints
- [ ] Budget model and database table
- [ ] All budget endpoints
- [ ] Budget period logic (monthly, quarterly, annual)
- [ ] Rollover calculation logic
- [ ] Tests for categories and budgets

**Frontend**
- [ ] Category management page
- [ ] Parent/child category display
- [ ] Create/edit category with colour picker
- [ ] Budget setup page
- [ ] Set budget per category per month
- [ ] Budget list with amounts

**Default system categories seeded at registration:**
```
Entertainment
  └── Streaming
  └── Sports
  └── Gaming
Household
  └── Rent / Mortgage
  └── Utilities
  └── Insurance
Food & Drink
  └── Groceries
  └── Eating Out
  └── Takeaway
Transport
  └── Car
  └── Public Transport
  └── Fuel
Health
  └── Medical
  └── Fitness
Personal
  └── Clothing
  └── Hair & Beauty
Phone & Internet
Banking & Finance
  └── Bank Fees
  └── Debt Payments
Education
Savings
Gifts & Celebrations
Travel
Income
  └── Salary
  └── Freelance
  └── Reimbursements
```

**Exit criteria:** A user can set a £800 monthly budget for Groceries 
and a £500 budget for Entertainment. Categories are grouped with 
parent/child relationships visible.

---

## Phase 4 — Transactions
**Goal:** Users can record what actually happened  
**Depends on:** Phase 3 complete

### Milestones

**Backend**
- [ ] Transaction model and database table
- [ ] All transaction endpoints
- [ ] All four transaction types (expense, income, transfer, refund)
- [ ] All three status values (pending, cleared, reconciled)
- [ ] Refund links to parent transaction
- [ ] Multi-currency with exchange rate capture
- [ ] Soft delete
- [ ] Tests for all transaction types and statuses

**Frontend**
- [ ] Transaction list view (filterable by account, category, month)
- [ ] Add transaction form
- [ ] Edit transaction
- [ ] Delete transaction (with confirmation)
- [ ] Status toggle (pending → cleared → reconciled)
- [ ] Refund flow — link back to original transaction
- [ ] Currency display per transaction
- [ ] Visual distinction between pending and cleared

**Exit criteria:** A user can record a £9.99 NowTV expense against 
Entertainment, mark it as cleared, and record a refund against the 
same category that reduces net spend. Pending transactions are 
visually distinct from cleared ones.

---

## Phase 5 — Schedules
**Goal:** Recurring transactions are planned automatically  
**Depends on:** Phase 4 complete

### Milestones

**Backend**
- [ ] Schedule model and database table
- [ ] All schedule endpoints
- [ ] Recurrence engine — generates pending transactions from schedules
- [ ] All frequency types (once, daily, weekly, monthly, 
      every_n_days, quarterly, annually)
- [ ] Start and end date handling
- [ ] Auto-generate toggle
- [ ] Schedule pause/resume
- [ ] Background job to generate upcoming scheduled transactions
- [ ] Tests for recurrence logic (this is complex — test it thoroughly)

**Frontend**
- [ ] Schedule list page
- [ ] Create schedule form with frequency options
- [ ] Visual calendar or list of upcoming scheduled transactions
- [ ] Pause/resume toggle
- [ ] Link from transaction back to its schedule

**Exit criteria:** Creating a schedule for "NowTV Entertainment, £9.99, 
13th of every month, January–June" automatically generates pending 
transactions for each of those months in the correct category. 
Pausing the schedule stops generation. Reactivating resumes it.

---

## Phase 6 — Monthly Plan View
**Goal:** The primary dashboard — the living spreadsheet  
**Depends on:** Phase 5 complete

### Milestones

**Backend**
- [ ] `/api/v1/plan/{year}/{month}` endpoint
- [ ] Assembles budgets, scheduled transactions, actual transactions,
      and reallocation adjustments in one response
- [ ] Calculates planned / actual / remaining per category
- [ ] Handles multi-currency display
- [ ] Distinguishes pending vs cleared in totals
- [ ] Tests for plan calculation logic

**Frontend**
- [ ] Monthly Plan View as default landing page after login
- [ ] Category rows grouped by parent
- [ ] Planned / actual / remaining columns
- [ ] Expandable rows — click to see transactions inline
- [ ] Month navigation (← previous / next →)
- [ ] Pending transactions shown with distinct visual style
- [ ] Colour indicators (on track / over budget / underspent)
- [ ] Currency label per row (£ / €)
- [ ] Mobile-responsive layout

**Exit criteria:** Landing on the dashboard for March 2026 shows 
every budget category with planned amounts from budgets, 
actual spend from cleared transactions, remaining balance, 
and scheduled-but-uncleared items clearly labelled as pending. 
Clicking Entertainment expands to show NowTV, Netflix, Disney+ inline.

---

## Phase 7 — Reallocation
**Goal:** Budget adjustments are tracked and permanent  
**Depends on:** Phase 6 complete

### Milestones

**Backend**
- [ ] Reallocation model and database table
- [ ] Reallocation endpoint (POST only — no delete)
- [ ] Plan view updated to reflect reallocations in budget totals
- [ ] Reallocation history endpoint
- [ ] Tests for reallocation logic

**Frontend**
- [ ] Reallocation button on Monthly Plan View
- [ ] Reallocation form (from category, to category, amount, reason)
- [ ] Reason field is mandatory — cannot submit without it
- [ ] Reallocation reflected immediately in planned column
- [ ] Reallocation history view — full audit trail
- [ ] Visual indicator on categories that have been reallocated this month

**Exit criteria:** Moving £100 from Groceries to Entertainment 
is recorded with a reason, immediately reflected in both category 
rows on the Monthly Plan View, and appears in the reallocation 
history permanently. It cannot be deleted.

---

## Phase 8 — Polish & Launch
**Goal:** The app is production-ready and publicly deployed  
**Depends on:** Phase 7 complete

### Milestones

**Quality**
- [ ] Full test coverage on all critical paths
- [ ] Error handling throughout (no unhandled exceptions)
- [ ] Loading states on all async operations
- [ ] Empty states (what does the app look like with no data?)
- [ ] Form validation with clear error messages
- [ ] Accessibility basics (keyboard navigation, screen reader labels)

**Deployment**
- [ ] Backend deployed to Railway (or similar)
- [ ] Frontend deployed to Vercel (or similar)
- [ ] PostgreSQL database on Supabase (or similar)
- [ ] Environment variables configured for production
- [ ] HTTPS enforced
- [ ] Demo account with sample data for portfolio use

**Documentation**
- [ ] README updated with live URL and setup instructions
- [ ] API documented (FastAPI auto-generates this)
- [ ] Screenshot or demo GIF in README

**Exit criteria:** The app is live at a public URL. 
A recruiter can visit it, register, and use it. 
The GitHub README links to the live app and explains what it is.

---

## Phase 9 — Phase 2 Features
**Goal:** The features that make it a real product  
**Depends on:** Phase 8 complete

- [ ] Tags and tag-based filtering
- [ ] Split transactions (one transaction, multiple categories)
- [ ] Monthly trend reports (spend over time per category)
- [ ] Year-to-date summary view
- [ ] CSV export
- [ ] Recurring transaction smart suggestions 
      (detect patterns and suggest schedules)

---

## Timeline Estimate

This is a learning project built alongside job hunting. 
Be honest with yourself about time.

| Phase | Estimated Duration | Notes |
|-------|-------------------|-------|
| 0 — Foundation | 1 week | Environment setup done, walking skeleton is the goal |
| 1 — Auth | 1-2 weeks | First real backend + frontend integration |
| 2 — Accounts | 1 week | Simpler once auth pattern is established |
| 3 — Categories & Budgets | 1-2 weeks | Hierarchy adds complexity |
| 4 — Transactions | 2 weeks | Most complex model, most edge cases |
| 5 — Schedules | 2 weeks | Recurrence logic is genuinely hard |
| 6 — Monthly Plan View | 2 weeks | Most important frontend work |
| 7 — Reallocation | 1 week | Simpler once plan view exists |
| 8 — Polish & Deploy | 1-2 weeks | Don't skip this — live URL matters |
| **Total MVP** | **~3-4 months** | At a realistic pace alongside other commitments |

---

## Git Commit Convention

Using conventional commits throughout — this is industry standard 
and looks professional on GitHub:

```
feat: add transaction create endpoint
fix: correct budget rollover calculation
docs: update TDD with reallocation design
test: add schedule recurrence tests
refactor: extract plan assembly into service layer
chore: update dependencies
```

Format: `type: short description in present tense`

---

## Definition of Done

A feature is not done until:
1. ✅ Tests written first (TDD — Red before Green)
2. ✅ All tests pass (Green)
3. ✅ Code refactored if needed (Refactor)
4. ✅ Backend endpoint works and is tested
5. ✅ Frontend displays and interacts correctly
6. ✅ Error cases handled gracefully
7. ✅ Code committed with meaningful conventional commit message
8. ✅ PRD/TDD updated if any design decisions changed

---

*This plan is a living document. Phases may be reordered or 
resized as we learn. The important thing is that something 
always works and the project always moves forward.*
