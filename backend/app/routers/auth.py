# app/routers/auth.py
#
# Purpose: HTTP endpoints for authentication — registration and login.
#
# Router pattern:
#   We create an APIRouter here (a mini-app) and register it in main.py.
#   This keeps main.py small and groups related endpoints together.
#   The router has a `prefix` so we don't repeat "/api/v1/auth" on every route.
#
# Endpoints:
#   POST /api/v1/auth/register  → creates a new user, returns UserResponse (201)
#   POST /api/v1/auth/login     → verifies credentials, returns TokenResponse (200)
#
# This module is the "thin HTTP layer" — it handles request/response shapes
# and delegates all logic to services/auth.py. Routes should be short.

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import UserCreate, UserResponse
from app.services.auth import create_access_token, hash_password, verify_password
from app.services.categories import seed_default_categories


# APIRouter collects related routes and applies shared config.
# prefix="/api/v1/auth": all routes below are relative to this path.
# tags=["auth"]: groups them under "auth" in the Swagger UI (/docs).
router = APIRouter(
    prefix="/api/v1/auth",
    tags=["auth"],
)


@router.post(
    "/register",
    response_model=UserResponse,        # FastAPI serialises the return value to this shape
    status_code=status.HTTP_201_CREATED,  # 201 = "a new resource was created"
                                          # 200 would mean "request processed successfully"
                                          # but 201 is more semantically precise for creation
)
def register(user_in: UserCreate, db: Session = Depends(get_db)) -> User:
    """
    Creates a new user account.

    FastAPI/Pydantic validates `user_in` automatically before this function
    runs — invalid email or short password returns 422 before we touch the DB.

    Steps:
        1. Check the email isn't already taken → 400 if it is
        2. Hash the password with bcrypt
        3. Create the User row in the database
        4. Return the new user (FastAPI filters to UserResponse shape — no password_hash)
    """
    # Step 1: reject duplicate emails
    # We check explicitly rather than catching a database IntegrityError because:
    #   - It's clearer what went wrong
    #   - IntegrityError messages are database-specific and hard to parse reliably
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists.",
        )

    # Step 2 + 3: hash the password and persist the user
    # We NEVER store user_in.password — only the bcrypt hash goes into the DB.
    user = User(
        email=user_in.email,
        password_hash=hash_password(user_in.password),
    )
    db.add(user)

    # Wrap the commit in try/except IntegrityError to handle the race condition
    # where two concurrent requests pass the SELECT check above simultaneously,
    # then both attempt to INSERT the same email. The UNIQUE constraint on the
    # email column is the true last line of defence — the database will reject
    # the second INSERT with an IntegrityError. We catch it, roll back the
    # transaction (required before the session can be reused), and return the
    # same 400 the explicit check above would have returned.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists.",
        )

    # db.refresh() reloads the user from the database after the commit.
    # This populates auto-generated fields (id, created_at, updated_at)
    # that were set by database defaults. Without this, they'd still be None.
    db.refresh(user)

    # Seed the standard set of system categories for this new user.
    # Called after the user commit so user.id is available and stable.
    # Every new user gets the same starting set of categories (Food & Drink,
    # Transport, etc.) with is_system=True so they cannot be deleted.
    seed_default_categories(user.id, db)

    return user  # FastAPI uses response_model=UserResponse to strip password_hash


@router.post("/login", response_model=TokenResponse)
def login(credentials: LoginRequest, db: Session = Depends(get_db)) -> dict:
    """
    Authenticates a user and returns a JWT access token.

    Steps:
        1. Look up the user by email
        2. Verify the password against the stored bcrypt hash
        3. If either check fails → 401 (same message for both — see note below)
        4. Create a JWT with the user's ID as the `sub` claim
        5. Return the token

    Security note — why the same 401 for wrong password AND unknown email:
        If we returned 404 for "email not found", an attacker could silently
        discover which email addresses have accounts (user enumeration).
        Returning 401 for both cases is intentionally ambiguous: "invalid
        credentials" — we're not telling you which part was wrong.
    """
    user = db.query(User).filter(User.email == credentials.email).first()

    # The `or` short-circuits: if user is None, verify_password is not called.
    # Both failure cases raise the same 401 with the same generic message.
    if user is None or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},  # Required by HTTP spec for 401
        )

    # Create a JWT. The `sub` (subject) claim identifies who the token belongs to.
    # We use the user's UUID (as a string) — stable, unguessable, and unique.
    # Email would also work as sub, but UUIDs are more stable (emails can change).
    token = create_access_token(data={"sub": str(user.id)})

    return {"access_token": token, "token_type": "bearer"}
