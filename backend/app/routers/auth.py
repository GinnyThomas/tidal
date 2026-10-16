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
#   POST /api/v1/auth/forgot-password → emails a reset link if the account exists (always 202)
#   POST /api/v1/auth/reset-password  → redeems a reset token for a new password (204 / 400)
#
# This module is the "thin HTTP layer" — it handles request/response shapes
# and delegates all logic to services/auth.py. Routes should be short.

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_db, get_session_factory
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    TokenResponse,
)
from app.schemas.user import UserCreate, UserResponse
from app.services import password_reset
from app.services.auth import create_token_for_user, get_current_user, hash_password, verify_password
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
        1. Normalise the email to lowercase
        2. Check the email isn't already taken → 400 if it is
        3. Hash the password with bcrypt
        4. Create the User row in the database
        5. Return the new user (FastAPI filters to UserResponse shape — no password_hash)
    """
    # Step 1: normalise email to lowercase.
    # Email addresses are case-insensitive by RFC 5321 — no real mail server
    # distinguishes "Ginny@example.com" from "ginny@example.com". Storing in
    # lowercase means login lookups are always exact-match fast and there is
    # no risk of duplicate accounts created with different capitalisations.
    #
    # NOTE: Existing users registered before this change who have uppercase
    # characters in their stored email would need a one-off migration:
    #   UPDATE users SET email = LOWER(email);
    # For now we only normalise going forward; all new registrations and logins
    # will be case-insensitive from this point.
    email = user_in.email.lower()

    # Step 2: reject duplicate emails
    # We check explicitly rather than catching a database IntegrityError because:
    #   - It's clearer what went wrong
    #   - IntegrityError messages are database-specific and hard to parse reliably
    existing = db.query(User).filter(User.email == email).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists.",
        )

    # Step 3 + 4: hash the password and persist the user
    # We NEVER store user_in.password — only the bcrypt hash goes into the DB.
    user = User(
        email=email,
        password_hash=hash_password(user_in.password),
    )
    db.add(user)

    # Flush to get the DB-assigned id (and catch duplicate email violations)
    # without committing yet. flush() writes the INSERT but keeps the transaction
    # open so we can add the categories in the same atomic unit of work.
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists.",
        )

    # db.refresh() reloads the user from the database after the flush.
    # This populates auto-generated fields (id, created_at, updated_at).
    db.refresh(user)

    # Stage the default system categories in the same open transaction.
    # seed_default_categories does NOT commit — it only calls db.add_all().
    # The single commit below persists both the user row and all category rows
    # atomically: if anything fails, neither the user nor the categories are saved.
    seed_default_categories(user.id, db)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed. Please try again.",
        )

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
    # Normalise to lowercase so "GINNY@example.com" matches a stored "ginny@example.com".
    email = credentials.email.lower()
    # Use func.lower() on the stored column as well as the input so that any
    # pre-existing rows with uppercase emails (registered before the normalisation
    # change) can still log in. Both sides are lowercased, making the comparison
    # fully case-insensitive at the database level.
    user = db.query(User).filter(func.lower(User.email) == email).first()

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
    # The `ver` claim (user.token_version) lets a password reset revoke it.
    token = create_token_for_user(user)

    return {"access_token": token, "token_type": "bearer"}


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,  # 204 = success with no response body
)
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),  # requires valid JWT
) -> None:
    """
    Changes the authenticated user's password.

    Steps:
        1. Verify body.current_password against the stored bcrypt hash.
           If it doesn't match → 400 Bad Request. We use 400 (not 401)
           because the user IS authenticated — their token is valid. The
           problem is the submitted password is wrong, which is a bad
           request, not an authentication failure.
        2. Hash the new password and save it.

    Returns 204 No Content on success — no body needed because the client
    already knows what happened (the password was changed).
    """
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    current_user.password_hash = hash_password(body.new_password)
    db.commit()


# Same message whether or not the account exists — see forgot_password().
FORGOT_PASSWORD_MESSAGE = "If an account exists for that email, a reset link is on its way."
INVALID_RESET_TOKEN_MESSAGE = "This reset link is invalid or has expired."


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,  # 202 = "accepted for processing" — the work happens afterwards
)
def forgot_password(
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    session_factory: sessionmaker[Session] = Depends(get_session_factory),
) -> dict:
    """
    Starts a password reset: if the email belongs to an active account, emails
    a single-use link to /reset-password?token=... on the frontend.

    Security note — user enumeration:
        Same reasoning as login's generic 401. The response is identical for
        known and unknown emails, so this endpoint can't be used to discover
        who has an account.

    Why is ALL the work in a background task?
        Timing. The lookup, the token INSERT + COMMIT and the Resend HTTP call
        only happen for real accounts; done inline, "account exists" would
        respond measurably slower than "no account". Here the route does the
        same thing for every email — queue the task, return — and the task
        runs after the response has been sent.
    """
    background_tasks.add_task(password_reset.request_password_reset, body.email, session_factory)
    return {"detail": FORGOT_PASSWORD_MESSAGE}


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)) -> None:
    """
    Sets a new password using the token from a reset email.

    400 (not 401/404) for a bad token: the request itself can't be fulfilled.
    One message covers unknown, used and expired tokens — the user's next step
    is the same in every case (request a new link).

    Success also bumps the user's token_version, logging out every existing
    session (see User.token_version).
    """
    if not password_reset.reset_password(body.token, body.new_password, db):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=INVALID_RESET_TOKEN_MESSAGE,
        )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Returns a fresh JWT with a new expiry for the authenticated user.

    The caller must provide a valid (non-expired) Bearer token. The response
    is a new token with the same user but a fresh expiry, extending the
    session without requiring the user to re-enter credentials.

    Used by the frontend's silent refresh interceptor to keep active users
    logged in indefinitely.
    """
    token = create_token_for_user(current_user)
    return {"access_token": token, "token_type": "bearer"}
