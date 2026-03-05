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

Phase 0 (walking skeleton) complete. Moving into Phase 1 (authentication).

---

## Getting Started on a New Machine

### Prerequisites

You will need:
- Python 3.13
- Node.js (LTS)
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
