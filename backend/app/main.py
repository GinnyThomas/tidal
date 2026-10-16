# app/main.py
#
# Purpose: FastAPI application entry point.
#
# This module creates the `app` object that Uvicorn runs.
# It registers middleware and defines top-level routes.
#
# To start the development server:
#   uvicorn app.main:app --reload
#   (the --reload flag restarts the server when you edit files)

from fastapi import Depends, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.routers import accounts, auth, budgets, categories, csv_mappings, opening_balances, plan, promotions, reallocations, schedules, transactions


# --- Create the FastAPI application ---
# title and version appear in the auto-generated API docs.
# Visit http://localhost:8000/docs to see them (Swagger UI).
# Visit http://localhost:8000/redoc for the ReDoc alternative.
app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="A multi-currency personal finance tracker.",
)


# --- CORS middleware ---
# CORS (Cross-Origin Resource Sharing) is a browser security feature.
# Browsers block JavaScript from making requests to a different "origin"
# (different hostname or port) unless the server explicitly permits it.
#
# allowed_origins is read from the ALLOWED_ORIGINS environment variable —
# a comma-separated list, e.g. "https://app.vercel.app,https://staging.vercel.app".
# The default in Settings covers local Vite development (http://localhost:5173).
#
# Why split on commas?
#   CORSMiddleware expects a list. Storing origins as a single env var string
#   (comma-separated) is the standard approach — one var, any number of origins.
_allowed_origins = [o.strip().rstrip('/') for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,   # Allow cookies and auth headers
    allow_methods=["*"],      # Allow GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],      # Allow Content-Type, Authorization, etc.
)


# --- Routers ---
# Each router is a collection of related endpoints defined in app/routers/.
# include_router() mounts all of a router's routes onto the main app.
# The router's `prefix` (e.g. "/api/v1/auth") is applied to every route in it.
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(budgets.router)
app.include_router(categories.router)
app.include_router(schedules.router)
app.include_router(transactions.router)
app.include_router(opening_balances.router)
app.include_router(promotions.router)
app.include_router(reallocations.router)
app.include_router(plan.router)
app.include_router(csv_mappings.router)


# --- Health check endpoint ---
# Convention: every production API has a health check endpoint.
# It's used by load balancers, container orchestrators (Kubernetes),
# and monitoring tools to confirm the service is alive and responding.
#
# GET /api/v1/health
#   - No authentication required
#   - Returns 200 OK with a simple JSON body
#   - The /api/v1/ prefix is our versioning convention (from CLAUDE.md)
@app.get("/api/v1/health")
def health_check() -> dict[str, str]:
    """Confirms the API is running. Used by monitoring and load balancers."""
    return {"status": "ok", "app": settings.APP_NAME}


# --- Database health check ---
# GET /api/v1/health/db
#   /health above is a "liveness" check: the process is up.
#   This is a "readiness" check: the process can actually reach PostgreSQL.
#
# It also keeps the Supabase free tier awake. Supabase pauses projects after
# 7 days without database activity; .github/workflows/keepalive.yml pings this
# endpoint daily so the `SELECT 1` counts as activity.
#
# On failure we return 503 with a fixed body — this endpoint is public, so the
# driver error (which can include hostnames) is never echoed back.
@app.get("/api/v1/health/db")
def db_health_check(response: Response, db: Session = Depends(get_db)) -> dict[str, str]:
    """Confirms the API can query the database. Returns 503 if it can't."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        response.status_code = 503
        return {"status": "unavailable", "database": "unreachable"}
    return {"status": "ok", "database": "ok"}
