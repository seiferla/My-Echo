"""Checks the Supabase access token and returns the user id (sub).

The signature is checked offline with Supabase's public keys (JWKS).
The user id comes ONLY from the token, never from the URL or the body.
"""
import os
import secrets
from typing import Annotated

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")

# Asymmetric only. HS256 (shared secret) and "none" are not allowed on purpose.
ALLOWED_ALGORITHMS = ["ES256", "RS256"]

_bearer = HTTPBearer(auto_error=False)
_jwks: PyJWKClient | None = None

BearerToken = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def _jwk_client() -> PyJWKClient:
    global _jwks
    if _jwks is None:
        _jwks = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True)
    return _jwks


def current_user(request: Request, credentials: BearerToken) -> str:
    """FastAPI dependency: returns the user id or answers 401.

    Also stores the id in request.state, so the rate limit counts per user.
    """
    if credentials is None:
        raise HTTPException(401, "not authenticated")
    try:
        key = _jwk_client().get_signing_key_from_jwt(credentials.credentials).key
        claims = jwt.decode(
            credentials.credentials,
            key,
            algorithms=ALLOWED_ALGORITHMS,
            audience="authenticated",
            issuer=f"{SUPABASE_URL}/auth/v1",
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid token") from None
    # Set only AFTER the check, so a forged token never counts for anyone.
    request.state.user_id = claims["sub"]
    return claims["sub"]


CurrentUser = Annotated[str, Depends(current_user)]


def require_metrics_token(credentials: BearerToken) -> None:
    """FastAPI dependency for /metrics: only the Prometheus token works, not a user token.

    Without METRICS_TOKEN, /metrics stays closed.
    """
    expected = os.getenv("METRICS_TOKEN", "")
    if not expected or credentials is None or not secrets.compare_digest(
        credentials.credentials.encode(), expected.encode()
    ):
        raise HTTPException(401, "not authenticated")
