# tests/test_auth.py
#
# Purpose: Tests for the authentication endpoints (register and login).
#
# TDD approach: these tests are written BEFORE the implementation exists.
# Run them now → they fail with 404 (the endpoints don't exist yet). RED.
# After writing the implementation → they pass. GREEN.
# Tidy up any rough edges → still pass. REFACTOR.
#
# We test BEHAVIOUR, not implementation:
#   - What HTTP status code does the endpoint return?
#   - Does the response body have the right shape and values?
#   - Does it handle bad input correctly?
# We don't assert on internal state (e.g., "was bcrypt called?").
#
# Each test function receives `test_client` from conftest.py — a TestClient
# backed by a fresh SQLite in-memory database. Each test starts with a
# completely empty database, so tests cannot interfere with each other.


# =============================================================================
# Registration tests
# =============================================================================


def test_register_returns_201_with_user_data(test_client) -> None:
    """
    Registering with a valid email and password should:
      - Return HTTP 201 Created (not 200 — 201 means a resource was created)
      - Return a JSON body with: id, email, default_currency, timezone, created_at
      - Never return password_hash (we assert its absence explicitly)
    """
    response = test_client.post(
        "/api/v1/auth/register",
        json={"email": "ginny@example.com", "password": "securepassword"},
    )

    assert response.status_code == 201

    body = response.json()
    assert body["email"] == "ginny@example.com"
    assert "id" in body
    assert "default_currency" in body
    assert "timezone" in body
    assert "created_at" in body
    # Security assertion: the hashed password must NEVER appear in any response.
    assert "password_hash" not in body


def test_register_with_duplicate_email_returns_400(test_client) -> None:
    """
    Registering the same email address twice should return 400 Bad Request
    on the second attempt.

    Why 400 and not 409 Conflict? Both are defensible. We use 400 here
    because it's simpler and widely used for "this request can't be fulfilled
    as-is." 409 would also be acceptable and slightly more specific.

    The first registration succeeds (201). The second is rejected because
    the email column has a UNIQUE constraint at the database level.
    """
    payload = {"email": "duplicate@example.com", "password": "securepassword"}

    first = test_client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201

    second = test_client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 400


def test_register_with_invalid_email_returns_422(test_client) -> None:
    """
    Sending a string that is not a valid email address should return 422
    Unprocessable Entity.

    This is caught by Pydantic's EmailStr validator BEFORE our endpoint
    code even runs — FastAPI validates all request bodies against the schema
    automatically. No database interaction happens for this case.

    422 is the standard FastAPI/Pydantic validation error code. The response
    body also contains a detailed description of what was wrong.
    """
    response = test_client.post(
        "/api/v1/auth/register",
        json={"email": "not-an-email", "password": "securepassword"},
    )

    assert response.status_code == 422


def test_register_with_short_password_returns_422(test_client) -> None:
    """
    Sending a password shorter than 8 characters should return 422.

    This is caught by Pydantic's Field(min_length=8) validator. Like the
    email check above, it happens before our code runs. The choice of 8
    characters is a common minimum — NIST guidelines suggest focusing on
    length rather than complexity requirements.
    """
    response = test_client.post(
        "/api/v1/auth/register",
        json={"email": "ginny@example.com", "password": "short"},
    )

    assert response.status_code == 422


# =============================================================================
# Login tests
# =============================================================================


def test_login_with_correct_credentials_returns_token(test_client) -> None:
    """
    Logging in with the correct email and password should return:
      - HTTP 200 OK
      - A response body with access_token (a non-empty string)
      - token_type of "bearer"

    We register first within this test to create the user. Each test has a
    fresh database, so we can't rely on users created in other tests.
    """
    # Arrange: create the user
    test_client.post(
        "/api/v1/auth/register",
        json={"email": "ginny@example.com", "password": "securepassword"},
    )

    # Act: log in
    response = test_client.post(
        "/api/v1/auth/login",
        json={"email": "ginny@example.com", "password": "securepassword"},
    )

    # Assert
    assert response.status_code == 200

    body = response.json()
    assert "access_token" in body
    assert body["access_token"]  # non-empty string
    assert body["token_type"] == "bearer"


def test_login_with_wrong_password_returns_401(test_client) -> None:
    """
    Logging in with the correct email but wrong password should return
    401 Unauthorized.

    Security note: we return the same generic "Invalid credentials" message
    for both wrong-password and unknown-email cases (see next test). This is
    intentional — revealing WHICH part was wrong would let attackers enumerate
    valid email addresses by trying different passwords.
    """
    test_client.post(
        "/api/v1/auth/register",
        json={"email": "ginny@example.com", "password": "securepassword"},
    )

    response = test_client.post(
        "/api/v1/auth/login",
        json={"email": "ginny@example.com", "password": "wrongpassword"},
    )

    assert response.status_code == 401


def test_login_with_unknown_email_returns_401(test_client) -> None:
    """
    Attempting to log in with an email that was never registered should return 401.

    Why 401 and not 404?
    Returning 404 ("not found") would confirm to an attacker that the email
    doesn't exist in our system — this is called "user enumeration." An attacker
    could use this to build a list of valid accounts to target.
    401 is intentionally ambiguous: "invalid credentials" covers both cases.
    """
    response = test_client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "securepassword"},
    )

    assert response.status_code == 401


# =============================================================================
# Email case normalisation tests
# =============================================================================


def test_register_normalises_email_to_lowercase(test_client) -> None:
    """
    Registering with a mixed-case email should store it as lowercase.

    This prevents the same person from creating duplicate accounts by varying
    the capitalisation of their email address. Email addresses are
    case-insensitive by RFC 5321 (the local part technically isn't, but no
    real mail server distinguishes case in practice).
    """
    response = test_client.post(
        "/api/v1/auth/register",
        json={"email": "Ginny@Example.COM", "password": "securepassword"},
    )

    assert response.status_code == 201
    # The stored email should be fully lowercase regardless of input casing.
    assert response.json()["email"] == "ginny@example.com"


def test_login_with_uppercase_email_succeeds(test_client) -> None:
    """
    Logging in with uppercase email should succeed even when the account was
    registered with a lowercase email.

    Both the stored email and the login email are lowercased before comparison,
    so Ginny@Example.com matches the stored ginny@example.com.
    """
    # Register with lowercase
    test_client.post(
        "/api/v1/auth/register",
        json={"email": "ginny@example.com", "password": "securepassword"},
    )

    # Log in with different capitalisation
    response = test_client.post(
        "/api/v1/auth/login",
        json={"email": "GINNY@EXAMPLE.COM", "password": "securepassword"},
    )

    assert response.status_code == 200
    assert "access_token" in response.json()


def test_duplicate_email_check_is_case_insensitive(test_client) -> None:
    """
    Attempting to register GINNY@EXAMPLE.COM when ginny@example.com already
    exists should return 400 — they are the same address.
    """
    test_client.post(
        "/api/v1/auth/register",
        json={"email": "ginny@example.com", "password": "securepassword"},
    )

    response = test_client.post(
        "/api/v1/auth/register",
        json={"email": "GINNY@EXAMPLE.COM", "password": "securepassword"},
    )

    assert response.status_code == 400
