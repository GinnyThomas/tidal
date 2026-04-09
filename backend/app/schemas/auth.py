# app/schemas/auth.py
#
# Purpose: Pydantic v2 schemas for authentication request and response shapes.
#
# Kept separate from user.py because these schemas are specific to the
# login/token flow and have no direct relationship to the User resource.
# Grouping by concern makes the codebase easier to navigate.

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """
    Shape of the request body for POST /api/v1/auth/login.

    We accept EmailStr here for consistency with registration — if the
    email format is invalid, we return 422 before any DB query runs.
    (A real login with a malformed email would fail anyway, but 422 is
    more informative than 401 for a clearly-invalid input.)
    """

    email: EmailStr
    password: str


class ChangePasswordRequest(BaseModel):
    """
    Shape of the request body for POST /api/v1/auth/change-password.

    current_password: the user's existing password, verified against the stored hash.
        If wrong, the endpoint returns 400 — the new password is never set.

    new_password: the replacement password. Must be at least 8 characters,
        consistent with the minimum enforced at registration.
    """

    current_password: str
    new_password: str = Field(min_length=8)


class TokenResponse(BaseModel):
    """
    Shape of the response body after a successful login.

    access_token: the JWT the client should store and send with future requests.
        Format: Authorization: Bearer <access_token>

    token_type: always "bearer" — this is an OAuth2 standard field.
        "bearer" means: "whoever holds this token is authenticated."
        The alternative (rarely used) is "mac" (Message Authentication Code).
        Clients use this field to know HOW to send the token, not just WHAT it is.
    """

    access_token: str
    token_type: str = "bearer"
