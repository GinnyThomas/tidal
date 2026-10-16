# Tidal — Handover

*Updated 2026-10-16 from a live audit of `main` at `876fe93` (PR #83). Supersedes the 2026-09-27 version, whose "orphaned commit" and "stale CLAUDE.md" findings have since been resolved.*

---

## What the app is

Multi-currency personal finance tracker.

- **Live:** https://tidal-vert.vercel.app (demo: `demo@tidal.app` / `TidalDemo2026!`)
- **Backend:** https://tidal-production.up.railway.app
- **Repo:** github.com/GinnyThomas/tidal
- **Stack:** FastAPI · PostgreSQL 16 · SQLAlchemy 2 · Alembic · Pydantic v2 (backend); React 19 · TypeScript · Vite · Router v7 · Tailwind v4 (frontend); Railway + Vercel + Supabase.

CLAUDE.md is the canonical description of architecture, models, routers, features and conventions — it was refreshed in `aaa7a89` and is accurate apart from the test count below. This file only covers *state* and *pending work*.

## State

- `main` is clean. **No open PRs.** Everything built to date is merged (latest: #83).
- **607 tests passing** — 185 backend, 422 frontend (CLAUDE.md updated to match).
- `ResizeObserver` is stubbed in `frontend/src/setupTests.ts`, so the HeadlessUI jsdom errors are gone. `ChangePasswordPage.test.tsx` still prints `act(...)` warnings — pre-existing and harmless.

## What changed recently (PRs #76–83)

CSV import, end to end: Monzo / Virgin Money / Santander España templates (auto-detected), manual column mapping saved per account, client + server dedup, category assignment during review (per-row and bulk), "Convert to Transfer" for mis-classified rows, and a run of real-world hardening — signed amounts stored as positive magnitudes, one bad row no longer blocks a file, correct row numbers after exclusions, Unicode minus, 100-char payee overflow moved to notes, Santander "PAGO MOVIL EN"/"COMPRA" prefixes stripped, currency follows the selected account, and server error detail surfaced in the import UI. `ge=0` now enforced on every amount field except `ImportTransactionRow.amount` (deliberately signed — it's `abs()`'d server-side).

## Pending

**Needs your attention**

1. **Production data from before the sign fix.** Rows imported into production before `126451e` (e.g. the Monzo Flex import) were stored with *negative* amounts, which inverts their effect on `calculated_balance` and blocks editing in the UI (`min="0"`). Code is fixed; existing rows were left for you to correct by hand. I can't see whether that's been done. If any remain, a one-off `UPDATE transactions SET amount = abs(amount) WHERE amount < 0` plus recomputing `dedup_hash` for those rows is the clean fix — back up first, and confirm scope with a `SELECT` before running it.
2. **Never clicked through in a browser by me.** No Chrome/browser session was connected, so Convert to Transfer, bulk category assign, currency sync and the Santander prefix stripping were verified by tests only. The category UI and import flow were exercised by you in screenshots; the rest is unconfirmed live.

**Housekeeping**

3. Delete stale local branches (not yet done). Every local branch except `main` is merged; `categoryAssignment`'s one commit `f4002b4` has the same patch-id as `0976a16` (in #83), so it's safe to force-delete.

**Backlog / known limitations**

4. **Annual CSV export writes hardcoded totals** instead of `=SUM()` formulas. Needs a narrow exception to `escapeCsvCell()`'s formula-injection protection plus a position-aware CSV builder. Scope to Annual totals only. (Also in CLAUDE.md tech debt and saved to memory.)
5. **Santander narrow export variant** (`Transaction date, Description, Amount, Currency` — no Value date/Balance) isn't auto-detected, so it goes through manual mapping once, then uses the saved mapping. Deliberate: widening `matches()` risks false positives against other banks.
6. **CSV refunds:** banks give no refund signal, so every positive amount imports as `income` (`TODO(refunds)`, pinned by a test).
7. **Dashboard vs Annual semantics (not a bug, but surprising):** the Annual grid shows *planned* only; actuals feed Cash Flow, and only for months already past (current month still uses planned until the 1st of next month). A category with £0 planned but real spend appears on the Dashboard but is hidden from the Annual grid, while still counting in Cash Flow.
8. Carried from CLAUDE.md, not re-verified: Annual view runs 12 plan queries per request, N+1 on account balances, annual cache is in-memory (not sessionStorage despite the name), React Query not wired up, no currency conversion despite `exchange_rate`, no Open Banking, no Google OAuth, no per-schedule actual spend.

## Running it

```bash
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload   # API :8000
cd frontend && npm run dev                                                  # UI  :5173
cd backend && python -m pytest tests/ -v
cd frontend && npm run test:run
```

Local dev DB needs `alembic upgrade head` after pulling (the CSV-import migration `a3f8c1d92e05` adds `dedup_hash`, `external_id`, `csv_mappings`). Production migrations use the direct `:5432` URL; see CLAUDE.md.
