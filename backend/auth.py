"""Prüft das Supabase-Access-Token und gibt die User-ID (sub) zurück.

Die App meldet sich direkt bei Supabase an und schickt den Token als
"Authorization: Bearer ..." mit. Das Backend prüft die Signatur offline mit den
öffentlichen Schlüsseln (JWKS). Die user_id kommt NUR aus dem Token, nie aus
der URL oder dem Body.
"""
import os

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")

# Nur asymmetrische Verfahren. HS256 (geteiltes Geheimnis) und "none" sind
# absichtlich nicht erlaubt.
ALLOWED_ALGORITHMS = ["ES256", "RS256"]

_bearer = HTTPBearer(auto_error=False)
_jwks: PyJWKClient | None = None


def _jwk_client() -> PyJWKClient:
    global _jwks
    if _jwks is None:
        _jwks = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True)
    return _jwks


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    """FastAPI-Dependency: liefert die user_id oder antwortet mit 401."""
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
        raise HTTPException(401, "invalid token")
    return claims["sub"]
