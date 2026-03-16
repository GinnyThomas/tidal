# app/services/auth.py
#
# Purpose: Authentication business logic — password hashing, JWT creation,
#          and the get_current_user dependency that protects routes.
#
# Why a separate services layer?
#   - Separation of concerns: HTTP routing (routers/) vs logic (services/)
#   - Services are independently testable without HTTP overhead
#   - Other parts of the app (CLI scripts, background jobs) can call these
#     functions without going through HTTP
#
# Libraries:
#   - passlib: high-level wrapper for bcrypt password hashing
#   - python-jose: JWT encoding and decoding
#   - fastapi.security: HTTPBearer for extracting Bearer tokens from headers

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User


# --- Password hashing context ---
#
# CryptContext manages a set of hashing "schemes". We configure it with
# bcrypt as our only (and therefore default) scheme.
#
# Why bcrypt and not SHA-256 or MD5?
#   SHA-256 and MD5 are designed to be FAST. That's great for checksums,
#   terrible for passwords. A modern GPU can compute billions of SHA-256
#   hashes per second, making brute-force attacks trivial.
#   Bcrypt is designed to be SLOW — it has a configurable "work factor"
#   (cost parameter) that makes each hash take ~100ms of CPU time.
#   Brute-forcing a single bcrypt hash takes years instead of seconds.
#
# deprecated="auto":
#   If we ever add a newer algorithm as the first entry in `schemes`,
#   passlib automatically recognises existing bcrypt hashes as "deprecated"
#   and re-hashes them on the next successful login. Zero-downtime upgrade.
#
# passlib handles salting automatically. We never manage salts manually.
# The salt is embedded in the hash output string.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# --- Bearer token extraction ---
#
# HTTPBearer extracts a Bearer token from the Authorization header.
#
# Why not OAuth2PasswordBearer?
#   OAuth2PasswordBearer is designed for the OAuth2 Password Grant flow, which
#   requires form-encoded credentials (username + password form fields). Our
#   login endpoint accepts JSON, not form data. Using OAuth2PasswordBearer would
#   be semantically wrong and would tell Swagger UI to show a misleading form.
#
# HTTPBearer does one thing: looks for Authorization: Bearer <token> and returns
# an HTTPAuthorizationCredentials object with a `.credentials` attribute holding
# the raw token string. No OAuth2 semantics, no form data assumptions.
#
# If the Authorization header is missing or not "Bearer <something>",
# FastAPI raises 403 automatically before our code runs.
http_bearer = HTTPBearer()


def hash_password(password: str) -> str:
    """
    Hashes a plain-text password using bcrypt.

    The hash output looks like:
        $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/lewohFbC.0DLBhfSG
    It includes: algorithm identifier, cost factor, salt, and hash.
    passlib generates a fresh random salt for each call automatically.
    """
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """
    Checks whether a plain-text password matches a stored bcrypt hash.

    passlib extracts the embedded salt from the hashed string, re-hashes
    the plain password with that salt, then compares. Returns True if they match.
    We never extract or store the salt ourselves — passlib handles it.
    """
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    """
    Creates a signed JWT (JSON Web Token) containing the given payload data.

    A JWT has three parts: header.payload.signature (each base64-encoded).
    The payload contains our `data` plus an expiry claim.
    The signature is created using SECRET_KEY — it cannot be forged without it.
    The payload is NOT encrypted — anyone can read it. But it cannot be
    tampered with because the signature would break.

    We add `exp` (expiry) automatically. After expiry, jwt.decode() raises
    JWTError, which our get_current_user turns into a 401 response.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode["exp"] = expire

    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(http_bearer),
    db: Session = Depends(get_db),
) -> User:
    """
    FastAPI dependency: validates a JWT and returns the authenticated User.

    Any route that requires authentication declares this as a dependency:
        current_user: User = Depends(get_current_user)

    Flow:
        1. http_bearer extracts the Bearer token from the Authorization header,
           returning an HTTPAuthorizationCredentials object. We read .credentials
           to get the raw token string.
        2. We decode and verify the JWT signature (raises JWTError if invalid/expired)
        3. We extract the user ID from the `sub` (subject) claim
        4. We look up the user in the database
        5. Return the User object for the route to use

    Failure cases (all return the same 401 — we don't reveal which check failed):
        - Missing or malformed Authorization header → http_bearer raises 403
        - Invalid JWT signature (tampered token) → JWTError → 401
        - Expired JWT → JWTError → 401
        - User ID in token doesn't match any user → 401
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        # WWW-Authenticate header is required by the HTTP spec when returning 401
        # for Bearer authentication. It tells the client what auth scheme to use.
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            credentials.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        # `sub` (subject) is the standard JWT claim for "who this token is for".
        # We stored the user's UUID as a string when creating the token.
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_error
    except JWTError:
        raise credentials_error

    # Convert the string UUID back to a uuid.UUID for the database query.
    # If user_id is somehow not a valid UUID string, we treat it as invalid.
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, AttributeError):
        raise credentials_error

    user = db.query(User).filter(User.id == user_uuid).first()
    if user is None:
        raise credentials_error

    return user
