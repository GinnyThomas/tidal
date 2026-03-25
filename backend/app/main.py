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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import accounts, auth


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
# Our React frontend runs on http://localhost:5173 (Vite's default port).
# Our API runs on http://localhost:8000.
# Different ports = different origins = CORS required.
#
# In production this list would be restricted to the real domain.
# For local development we allow the Vite dev server.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
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
