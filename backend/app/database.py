# app/database.py
#
# Purpose: SQLAlchemy setup — engine, session factory, and the get_db dependency.
#
# SQLAlchemy has two layers:
#   - Core: raw SQL expressions, connections, engine
#   - ORM: maps Python classes (models) to database tables
# We use both. The engine is Core; our models and sessions use the ORM.

from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


# --- Engine ---
# The engine is the entry point to the database.
# It holds a connection pool (reuses open connections rather than opening
# a new one for every request, which is expensive).
#
# pool_pre_ping=True: before using a connection from the pool, SQLAlchemy
# sends a lightweight "ping" query to check it's still alive. Without this,
# long-idle connections can go stale and cause mysterious errors.
engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)


# --- Session factory ---
# SessionLocal is a class (a "factory") that creates Session objects.
# Each Session represents one unit of work with the database — it tracks
# which objects have been loaded, modified, or created, and manages the
# transaction that wraps them.
#
# autocommit=False: we control when transactions are committed.
#   Leaving this False (the default) is safer — changes only hit the
#   database when we explicitly call db.commit().
#
# autoflush=False: SQLAlchemy won't automatically write pending changes to
#   the DB before a query within the same session. We control flushing.
#   This avoids surprising implicit writes.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# --- Base class for all SQLAlchemy models ---
# Every model (User, Account, Transaction, etc.) will inherit from Base.
# DeclarativeBase is the modern SQLAlchemy 2.x way to define the base.
# It replaces the older `declarative_base()` function call.
class Base(DeclarativeBase):
    pass


# --- FastAPI dependency: get_db ---
# This function provides a database session to any route that requests one.
#
# How FastAPI dependencies work:
#   A route declares `db: Session = Depends(get_db)` in its parameters.
#   FastAPI calls get_db(), gets the yielded value (the session), injects it
#   into the route, and then — after the route returns — resumes get_db()
#   to run the cleanup code in the `finally` block.
#
# The `yield` makes this a "generator dependency". The try/finally pattern
# guarantees db.close() runs even if the route raises an exception.
# Closing the session returns the underlying connection to the pool.
#
# Generator[Session, None, None] means:
#   yields Session, receives nothing sent in, returns nothing
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db  # FastAPI injects this session into the route
    finally:
        db.close()  # Always runs — connection returned to pool
