# Handover — Automatic daily bank feed sync

*Written 2026-11-25, against `main` at `8aae946` (PR #96 merged). Read CLAUDE.md first; this file
only covers this one piece of work.*

---

## Goal

Linked bank accounts sync into Tidal **once a day with no clicks**. Today every account needs its own
"Sync now" click on `/bank-feeds`. Ginny has 8 linked Monzo accounts via BankSync, so that's 8 clicks.

**Done means:**
- A Railway cron job runs every morning and syncs every linked, unexpired account for every user who
  has one.
- Failures are visible on the Bank Feeds page, not only in Railway logs: an expired API key, expired
  consent, a rate limit, or a provider outage.
- A manual "Sync now" and the scheduled run can never double-import the same transaction.
- Tests are written first (pytest), CLAUDE.md is updated, and any migration is run on production
  **before** the PR merges.

## Current state (what exists)

- **Sync logic lives inside the route**: `sync_link()` in `backend/app/routers/bank_feeds.py`
  (`POST /bank-feeds/links/{id}/sync`). It works out the window (first sync 90 days back; after
  that, `last_synced_at` minus a 7-day overlap), calls `provider.fetch_transactions()`, writes
  through `services/importer.py::import_rows()`, then sets `link.last_synced_at`. It raises
  `HTTPException`s, so the job can't reuse it as it is.
- **Choosing a provider depends on the logged-in user**: `get_bank_feed_providers()` in
  `services/bank_feeds/__init__.py` is a FastAPI dependency built on `get_current_user`. BankSync is
  offered only to the user whose email matches `BANKSYNC_OWNER_EMAIL`, because its key reads one
  person's banks. The job has no request and no logged-in user, so this needs a plain-function
  version.
- **Duplicates are stopped in Python only**: `import_rows()` loads the account's existing
  `external_id`s and `dedup_hash`es into sets, then inserts. Nothing in the database forces
  `transactions(account_id, external_id)` to be unique. **Two syncs of the same account running at
  the same time could both insert the same transaction.** Today that needs two quick clicks; a
  scheduled job makes it realistic.
- **BankSync limits**:
  - 10 requests per minute on the Standard plan.
  - A sync makes 1 request per page per account (Ginny's accounts are 1 page each).
  - A 429 becomes `BankFeedError(status_code=429, retry_after=N)`.
  - BankSync itself refreshes from Monzo about once a day, so syncing Tidal more often than daily
    brings in nothing new.
- **Deployment**: Railway runs the backend from `backend/Procfile`
  (`web: uvicorn app.main:app --host 0.0.0.0 --port $PORT`). The production service is named
  **`tidal`**. Variables there include `DATABASE_URL` (Supabase pooled :6543), `BANKSYNC_API_KEY`,
  `BANKSYNC_OWNER_EMAIL`, `ENABLE_BANKING_*` and `RESEND_API_KEY`.

## Decisions (and why)

1. **Use a Railway cron service that runs a Python module, not an HTTP endpoint.**
   Add a second Railway service from the same repo and `backend` root, with start command
   `python -m app.jobs.sync_bank_feeds` and a cron schedule. It talks to the database directly.
   - *Why:* no new public endpoint and no shared secret to protect. Nothing has to wake the web
     service from its ~30s cold start. Runs show up in Railway's own history.
   - *Rejected:* GitHub Actions calling a token-protected endpoint (a new attack surface and a
     secret kept in two places). An in-process scheduler such as APScheduler (runs once per
     worker, so it can double-fire, and stops when the service sleeps).
2. **Pull the sync logic out into a service function shared by the route and the job.**
   Put it in `services/bank_feed_sync.py`, which raises domain errors. The route turns those into
   HTTP errors; the job records them. There should be one code path, as with CSV import and sync.
3. **Lock the link row while it syncs.** Use `SELECT … FOR UPDATE NOWAIT` on the
   `bank_account_links` row (`with_for_update(nowait=True)`), held until commit.
   - A manual "Sync now" that hits a sync already in progress gets a 409 ("A sync is already
     running for this account").
   - The job skips a locked account and logs it.
   - This fixes the race without changing the `transactions` table. A unique index on
     `(account_id, external_id)` would be a stronger guarantee, but existing rows might already
     break it. Leave it as a separate, investigated follow-up.
   - SQLite (the test database) ignores `FOR UPDATE`. Test that the lock is requested, not the
     blocking itself, or add a Postgres-only test next to `test_migrations_rls.py`.
4. **Record each attempt on the link** with two nullable columns on `bank_account_links`:
   - `last_sync_attempt_at` (timestamptz)
   - `last_sync_error` (String(255), NULL after a success)

   The manual route and the job both write them. The page shows the error under the account.
   - *Why:* Ginny won't read Railway logs. An expired key (hers expires around late February 2027)
     should show on the page she uses.
5. **The job only syncs. It doesn't refresh.** It never calls `list_connections()`, so it never
   adds or removes connections or accounts. Structural changes stay user-initiated via "Refresh
   from BankSync". Expired consent is already known from `valid_until`. A connection BankSync later
   flags for re-authentication fails its sync, and that error is recorded (decision 4).
6. **Pace requests rather than race them.**
   - Sync accounts one after another and sleep about 7s between provider calls (under 10 per
     minute).
   - On `BankFeedError` 429, sleep `retry_after` (default 60s) and retry that account once.
   - A job may sleep; a web request must not.
   - 8 accounts take about a minute.
7. **Schedule: daily at 06:00 UTC** (`0 6 * * *`). Railway cron schedules are UTC. That's 06:00 GMT
   / 07:00 BST, before Ginny looks at her money. Exact BankSync refresh times are unknown, but the
   7-day overlap means a late refresh is caught the next day.
8. **Exit code.** Exit 0 when every attempted account synced, or was skipped for an expected reason
   (unlinked, expired). Exit 1 if any account errored, so Railway marks the run as failed.

## Design

```
backend/app/services/bank_feed_sync.py   (new)
    class SyncSkipped(Exception)           # unlinked / consent expired / provider unavailable / locked
    class SyncFailed(Exception)            # provider error; carries the BankFeedError

    def providers_for_user(user: User) -> dict[str, BankFeedProvider]
        # Plain function the job calls. get_bank_feed_providers() becomes a thin
        # Depends wrapper around it, so the BANKSYNC_OWNER_EMAIL gate lives in ONE place.

    def sync_account(db, link: BankAccountLink, providers) -> dict
        # Locks the link (NOWAIT), checks linked / expired / provider, picks the window,
        # fetches, import_rows(), sets last_synced_at + last_sync_attempt_at, clears
        # last_sync_error, commits. On provider error: sets last_sync_attempt_at +
        # last_sync_error (short, log-safe text), commits, raises SyncFailed.

backend/app/routers/bank_feeds.py
    sync_link() → calls sync_account(); maps SyncSkipped → 409/503, SyncFailed → _provider_error(),
                  lock contention → 409. Same responses as today plus the new 409.
    BankAccountLinkResponse gains last_sync_attempt_at, last_sync_error.

backend/app/jobs/__init__.py, backend/app/jobs/sync_bank_feeds.py   (new)
    main() -> int
        # One DB session from get_session_factory(). Loads every BankAccountLink with
        # account_id set, its connection active and unexpired, grouped by user. Per user:
        # providers_for_user(user). Per link: sync_account(), pacing between calls,
        # one retry after a 429. Logs one line per account (created / duplicates /
        # skipped reason / error). Returns 0 or 1 (decision 8).
    if __name__ == "__main__": sys.exit(main())
    # Calls app.logging_config setup so app.* INFO lines reach Railway logs.

migration: add bank_account_links.last_sync_attempt_at, last_sync_error (both nullable)

frontend/src/pages/BankFeedsPage.tsx
    - Under each account: "Last sync failed: {last_sync_error}" in coral when set.
    - Small note under the BankSync card: "Synced automatically every morning."
      (Hard-coded text is fine; a config endpoint isn't worth it yet.)
```

**Logging:** never log transaction contents, payees or amounts. Log counts and link ids only, as the
current route does.

## Steps (TDD: red → green → refactor at each one)

1. **Extract `providers_for_user()`.** The existing owner-gate tests in `tests/test_bank_feeds.py`
   must still pass unchanged. Add a direct unit test that the function returns `banksync` only for
   the owner.
2. **Extract `sync_account()`** into `services/bank_feed_sync.py`, moving logic out of the route.
   All existing sync tests in `test_bank_feeds.py` stay green. Add service-level tests for:
   - each `SyncSkipped` reason
   - `SyncFailed` recording `last_sync_error`
   - a success clearing it
3. **Migration plus model columns.** Revise **whatever `alembic heads` shows at the time**. A
   schedules migration, `b8d2f4a6c1e3` (revising `a7c3e9f2b4d1`), is in progress on another
   branch and may land first. Use `sa.DateTime(timezone=True)` and `sa.String(255)`, both nullable,
   so no `server_default` is needed. It's an existing table, so no RLS line. Round-trip it locally
   (`alembic upgrade head`, `alembic downgrade -1`, `alembic upgrade head`).
4. **Row lock and the 409 on contention** in the route. Test the 409 by making the lock attempt
   raise `OperationalError` (monkeypatch), since SQLite can't block for real.
5. **The job module.** Test `main()` against the SQLite test database with the fake providers from
   `test_bank_feeds.py` (move them to a shared fixture module):
   - syncs only linked, unexpired accounts
   - only offers BankSync to the owner's links
   - continues after one account fails, and returns 1
   - returns 0 when all succeed
   - retries once after a 429 (patch `time.sleep` so the test doesn't wait)
   - logs no payees
6. **Frontend**: show the error and the "every morning" note (Vitest + RTL first).
7. **CLAUDE.md**: add the job, the new columns, the Railway cron service and the env vars it
   needs. Update the test counts. Remove "scheduled sync" from Bank Feeds → Next and from Known
   Tech Debt.

## Deployment (Ginny does the Railway parts)

1. **Run the migration on production before merging**, using the session pooler as described in
   CLAUDE.md. Load the URL with `read -rs` rather than typing it into the command, then `unset`
   it afterwards.
2. Merge. The web service redeploys itself.
3. **Create the cron service in Railway:**
   - New → GitHub repo `GinnyThomas/tidal`, root directory `backend`.
   - Settings → *Custom Start Command*: `python -m app.jobs.sync_bank_feeds`. This overrides the
     Procfile's `web:` process.
   - Settings → *Cron Schedule*: `0 6 * * *`.
   - Variables: reference the web service's values rather than copying secrets, e.g.
     `DATABASE_URL=${{tidal.DATABASE_URL}}`. Do the same for `SECRET_KEY`, `BANKSYNC_API_KEY`,
     `BANKSYNC_OWNER_EMAIL`, `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY`. Copy
     anything else `app.config.Settings` requires at import time; check `config.py` for required
     fields.
   - No public domain or networking is needed.
4. **Run it once by hand** from Railway's cron view ("Run now", if offered) and check:
   - the logs show one line per account and the run exits 0
   - the Bank Feeds page shows fresh "last synced" dates
5. **Verify in Railway's docs while setting up** (from memory, not re-checked):
   - cron times are UTC
   - the shortest interval is 5 minutes
   - the process must exit for the next run to start
   - a run that's still going causes the next one to be skipped

## Open questions for Ginny

- **Email on failure?** `services/email.py` can already send via Resend, but there's no verified
  domain, so it only reaches the Resend account owner (Ginny), which is fine here. Recommended:
  email only when a run has errors, at most once a day. Optional; the job works without it.
- **Should the job also sync Enable Banking connections?** It does by default, because
  `providers_for_user()` returns every configured provider. Ginny's only one is the stale
  "Mock ASPSP" sandbox connection, which she was advised to remove.
- **Keep a "Sync all" button as well?** It's cheap once `sync_account()` exists: loop in the
  frontend, or add `POST /bank-feeds/sync-all`. Useful straight after linking a new account.

## Don't

- Don't add an HTTP endpoint for the cron job (decision 1).
- Don't have the job call `list_connections()` or delete anything (decision 5).
- Don't sync in parallel or skip the pacing; BankSync's limit is 10 requests a minute.
- Don't bypass `providers_for_user()`. BankSync must only ever sync `BANKSYNC_OWNER_EMAIL`'s links,
  including in the job.
- Don't commit or merge before the production migration has run (Railway auto-deploys on merge).
