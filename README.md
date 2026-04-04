# Tidal

A multi-currency personal budget and finance tracker built with Python, FastAPI, PostgreSQL and React.

## Structure

```
tidal/
├── backend/     Python + FastAPI REST API
├── frontend/    React + TypeScript application
└── docs/        PRD, TDD, and project plan
```

## Status

- ✅ Phase 0: Walking skeleton (health endpoint, React frontend connected)
- ✅ Phase 1: Authentication (register, login, JWT, ProtectedRoute, Alembic)
- ✅ Phase 2: Accounts (CRUD, soft delete, frontend with add form)
- ✅ Phase 3: Categories (hierarchical, system seeding, hide/unhide, frontend)
- ✅ Phase 4: Transactions (expense/income/transfer/refund, pending/cleared/reconciled)
- ✅ Phase 5: Schedules (recurrence engine, auto-generate pending transactions)
- ✅ Phase 6: Monthly Plan View (primary dashboard, plan vs actual)
- ✅ Phase 7: Reallocation (budget adjustments, permanent audit trail)
- ⏳ Phase 8: Polish & Deploy (Railway + Vercel + Supabase, demo account)

---

## Getting Started on a New Machine

### Prerequisites

You will need:
- Python 3.13
- Node.js (LTS) (react-router-dom v7 requires Node 20+)
- PostgreSQL 16 or 17

On Ubuntu/Debian, install PostgreSQL with:
```bash
sudo apt install postgresql postgresql-client
```

### 1. Clone the repo

```bash
git clone <repo-url>
cd tidal
```

### 2. Set up the backend

```bash
cd backend
```

**Create a virtual environment.**
If `python3 -m venv .venv` fails (missing `ensurepip`), use `virtualenv` instead:
```bash
# Install pip first if needed (no pip on system)
wget https://bootstrap.pypa.io/get-pip.py -O /tmp/get-pip.py
python3 /tmp/get-pip.py --user --break-system-packages

# Then install virtualenv and create the venv
~/.local/bin/pip install virtualenv --break-system-packages
~/.local/bin/virtualenv .venv
```

Or if `python3 -m venv .venv` works normally:
```bash
python3 -m venv .venv
```

**Install dependencies:**
```bash
.venv/bin/pip install -r requirements.txt
```

**Create your `.env` file:**
```bash
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and generate a SECRET_KEY:
# python3 -c "import secrets; print(secrets.token_hex(32))"
```

**Run database migrations:**
```bash
.venv/bin/alembic upgrade head
```

### 3. Create the PostgreSQL databases

PostgreSQL uses peer authentication by default — you need to run setup commands as the `postgres` system user:

```bash
sudo -u postgres psql -c "CREATE USER tidal_user WITH PASSWORD 'tidal_password';"
sudo -u postgres psql -c "CREATE DATABASE tidal OWNER tidal_user;"
sudo -u postgres psql -c "CREATE DATABASE tidal_test OWNER tidal_user;"
```

Then update your `backend/.env` to use TCP (not a socket) so password auth works:
```
DATABASE_URL=postgresql://tidal_user:tidal_password@127.0.0.1:5432/tidal
```

Note: use `127.0.0.1` not `localhost` — this forces TCP and allows password authentication.

### 4. Set up the frontend

```bash
cd frontend
npm install
```

**Create your `.env` file:**
```bash
cp .env.example .env
# The default value (http://localhost:8000) is correct for local development.
# No edits needed unless your backend runs on a different port.
```

### 5. Run the tests

```bash
# Backend
cd backend
.venv/bin/python -m pytest tests/ -v

# Frontend
cd frontend
npm run test:run
```

Both suites should pass before you start the servers.

### 6. Start the development servers

In two separate terminals:

```bash
# Terminal 1 — backend
cd backend
.venv/bin/uvicorn app.main:app --reload

# Terminal 2 — frontend
cd frontend
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs (Swagger): http://localhost:8000/docs
- Health check: http://localhost:8000/api/v1/health

---

## Deploying to Production

Tidal uses three services for production:

| Service | Purpose |
|---------|---------|
| [Supabase](https://supabase.com) | PostgreSQL database (hosted) |
| [Railway](https://railway.app) | Backend (FastAPI + Uvicorn) |
| [Vercel](https://vercel.com) | Frontend (React + Vite) |

### Supabase (database)

1. Create a free account at [supabase.com](https://supabase.com).
2. Click **New project** and fill in a project name, database password, and region.
3. Once the project is ready, go to **Project Settings → Database**.
4. Find the **Connection string** section. Copy the **URI** under **Connection pooling** (uses PgBouncer — better for serverless environments):
   ```
   postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
   ```
5. You will paste this into Railway as `DATABASE_URL` (see below).

> If you need direct connections (e.g. for running Alembic migrations), use the direct URI from the same page (port 5432, no `?pgbouncer=true`). Run migrations locally or via a Railway one-off job, then switch back to the pooling URL for the live app.

### Railway (backend)

1. Create a free account at [railway.app](https://railway.app).
2. Click **New project → Deploy from GitHub repo** and select this repository.
3. Railway detects the `Procfile` in `backend/` and sets the start command automatically:
   ```
   web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
4. In the Railway project, go to your service → **Variables** and add the following environment variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | Your Supabase connection string | See Supabase section above |
| `SECRET_KEY` | A long random string | Generate: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` | Your Vercel frontend URL — set after deploying Vercel |
| `ALGORITHM` | `HS256` | JWT signing algorithm — no need to change |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | How long JWTs stay valid |

5. Railway will redeploy automatically when you push to the connected branch.
6. Your backend will be available at a URL like `https://your-app.railway.app`. You will need this URL when setting up the Vercel frontend.

> **Run migrations in production:** After deploying, run migrations against the Supabase database using the direct connection URL locally:
> ```bash
> cd backend
> DATABASE_URL="postgresql://..." .venv/bin/alembic upgrade head
> ```

### Vercel (frontend)

1. Create a free account at [vercel.com](https://vercel.com).
2. Click **Add New → Project** and import this repository.
3. Set the **Root Directory** to `frontend` (Vercel needs to know where to find `package.json`).
4. Vercel detects Vite automatically and sets the correct build command (`npm run build`) and output directory (`dist`).
5. Under **Environment Variables**, add:

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_API_URL` | `https://your-app.railway.app` | Your Railway backend URL — no trailing slash |

6. Click **Deploy**. Vercel will build and host the frontend.
7. The `vercel.json` at the root of `frontend/` configures a catch-all rewrite so React Router handles all paths:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
   ```
   Without this, navigating directly to `/dashboard` or `/categories` would return a 404 from Vercel.

> **Update Railway after Vercel deploys:** Once you have your Vercel URL, go back to Railway and update `ALLOWED_ORIGINS` to match it. This is required for CORS — the browser will block API requests from the frontend until this is set correctly.

### Linking it all together

The order matters:

1. **Supabase first** — get the `DATABASE_URL`.
2. **Railway second** — deploy backend, set `DATABASE_URL` + `SECRET_KEY`. Note your Railway URL.
3. **Vercel third** — deploy frontend, set `VITE_API_URL` to your Railway URL. Note your Vercel URL.
4. **Back to Railway** — update `ALLOWED_ORIGINS` to your Vercel URL.

After all four steps, the full stack is live and connected.
