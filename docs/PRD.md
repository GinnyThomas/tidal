# Tidal — Product Requirements Document

**Version:** 0.1  
**Status:** Draft  
**Author:** Ginny Thomas  
**Last Updated:** March 2026

---

## 1. Problem Statement

Existing budgeting apps (Spendee, Mint, YNAB, Monarch) fail users who manage complex, 
multi-currency, multi-household finances. Specifically they fail in four ways:

1. **Pending transactions corrupt budget views** — uncleared transactions with wrong 
   categories make budgets inaccurate until they settle, sometimes days later.

2. **No recurring transaction memory** — apps repeatedly mis-categorise the same 
   recurring merchants, requiring manual correction every month.

3. **Budget and transaction views are separated** — users must navigate between screens 
   to understand their financial position, losing the spatial awareness that makes a 
   spreadsheet powerful.

4. **No structured budget reallocation** — when users move money between budget 
   categories mid-month ("robbing Peter to pay Paul"), there is no way to track this 
   intentional decision or learn from it over time.

---

## 2. Vision

Tidal is a multi-currency personal finance tracker that feels like a living spreadsheet.

The primary view is a **Monthly Plan View** — a single screen showing every budget 
category, what was planned, what has actually been spent, and what remains. Transactions 
are accessible inline. Nothing important requires navigating away.

**Tagline (working):** *Know where you stand. Always.*

---

## 3. Target Users

**Primary user — the complex household manager**
- Manages finances across multiple accounts, currencies, and properties
- Currently uses a combination of spreadsheets and budgeting apps
- Frustrated by the gap between what their spreadsheet shows and what apps can do
- Technically comfortable but not a developer

**Secondary user — the financially organised individual**
- Single currency, simpler financial life
- Wants more structure and visibility than a basic app provides
- Values clean design and honest data over feature bloat

---

## 4. Core Principles

**Plan first, track second.** Tidal is built around what you *expect* to happen, not 
just what has happened. Schedules define the plan. Transactions confirm reality. The 
gap between them is where insight lives.

**Honest budgets only.** Pending transactions never silently corrupt budget totals. 
A transaction is either planned (from a Schedule) or confirmed (cleared/reconciled). 
The user always knows which they are looking at.

**Decisions leave traces.** Every budget reallocation is recorded with a reason. 
Over time this builds a picture of how and why financial plans change.

**Multi-currency is first class.** GBP and EUR (and any other currency) are treated 
as equals throughout the app. No forced conversion, no hidden assumptions.

---

## 5. MVP Feature Scope

### 5.1 In Scope — Phase 1 (MVP)

**Authentication**
- User registration with email and password
- Login and logout
- Password hashing (never stored in plain text)
- JWT-based session management

**Accounts**
- Create, edit, deactivate accounts
- Account types: checking, savings, credit card, cash, mortgage, loan
- Manual transaction entry (Quicken-style)
- Multi-currency accounts
- Current balance tracking

**Categories**
- Create and manage categories
- Parent/child category hierarchy (e.g. Entertainment > Streaming)
- Default system categories provided on registration
- Colour coding for UI display

**Budgets**
- Set budget amounts per category per month
- Monthly, quarterly, and annual budget periods
- Rollover toggle — unspent amount carries to next period
- Budget vs actual comparison at a glance

**Schedules**
- Create recurring transaction rules
- Frequency options: once, daily, weekly, monthly, every n days, 
  quarterly, annually
- Start and end dates
- Auto-generate pending transactions from schedules
- Pause/resume without deleting
- Per-schedule category assignment (solves the recurring mis-categorisation problem)

**Transactions**
- Full CRUD (create, read, update, delete — logical deletes only)
- Transaction types: expense, income, transfer, refund
- Status: pending / cleared / reconciled
- Link refunds to original transactions via parent_transaction_id
- Link transactions to schedules via schedule_id
- Multi-currency with exchange rate capture
- Optional note field
- Pending transactions clearly distinguished from cleared in all views

**Reallocation**
- Move budget from one category to another mid-period
- Mandatory reason field
- Permanent audit trail — reallocations are never deleted
- Visible in monthly view alongside budget totals

**Monthly Plan View (Primary Dashboard)**
- Default landing page after login
- Rows grouped by category parent (Entertainment, Household, Food etc.)
- Each row shows: planned / actual / remaining
- Expandable rows to show line item transactions inline
- Currency displayed per row — no forced conversion
- Colour indicators for on-track / over budget / underspent
- Month navigation (previous / next)
- Scheduled but unconfirmed transactions shown as pending, clearly labelled

### 5.2 Out of Scope — Phase 2

- Tags and tag-based filtering
- Split transactions (one transaction, multiple categories)
- Bank sync / open banking integration
- Reporting and trend analysis across multiple months
- Mobile application (iOS / Android)
- Multiple users / household sharing
- Data export (CSV, PDF)
- Notifications and reminders

---

## 6. User Stories

### Authentication
- As a user I can register with my email and password so that I have a secure account
- As a user I can log in and out so that my data is private
- As a user my password is never stored in plain text so that I am protected if 
  the database is compromised

### Accounts
- As a user I can create multiple accounts so that I can track money across 
  different banks and cash
- As a user I can mark an account as manual so that I can enter transactions 
  myself like Quicken
- As a user I can create accounts in different currencies so that my GBP and 
  EUR accounts are tracked separately

### Budgets and Categories
- As a user I can set a monthly budget per category so that I know how much 
  I intend to spend
- As a user I can see budget vs actual in one view so that I always know where I stand
- As a user I can reallocate budget between categories mid-month so that I can 
  respond to real life
- As a user every reallocation requires a reason so that I can understand my 
  patterns over time

### Schedules
- As a user I can create a recurring schedule for NowTV so that it is always 
  assigned to Entertainment without me touching it
- As a user I can set a start and end date on a schedule so that seasonal 
  subscriptions appear only in the right months
- As a user scheduled transactions appear as pending in my monthly view so that 
  my budget is always forward-looking not just backward-looking

### Transactions
- As a user I can mark a transaction as cleared when it hits my account so that 
  my budget reflects reality not expectation
- As a user I can record a refund against the original expense category so that 
  my Clothing budget correctly reflects net spend not gross spend
- As a user pending transactions never count as confirmed budget spend so that 
  my budget view is always honest

---

## 7. Success Metrics

For MVP the definition of success is:

1. The app correctly reflects a monthly budget with planned vs actual for all categories
2. Recurring transactions are auto-categorised without manual intervention
3. Pending transactions are visually distinct and excluded from confirmed budget totals
4. A budget reallocation can be made and is permanently recorded with its reason
5. GBP and EUR accounts coexist without forced conversion

---

## 8. Out of Scope Permanently (for this product)

- Investment tracking
- Tax calculation or filing
- Business / company accounts
- Cryptocurrency
- Payroll management

---

*This document will be updated as the product evolves. All significant changes 
should be noted with version and date.*
