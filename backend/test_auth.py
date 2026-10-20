"""Tests für die Token-Prüfung (auth.py). Brauchen keine Datenbank und kein Netz:
ein eigenes EC-Schlüsselpaar signiert die Test-Tokens, der JWKS-Abruf ist ersetzt."""
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

import auth

ISS = "https://test.supabase.co/auth/v1"
KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


def _claims(**overrides):
    claims = {"sub": "user-1", "aud": "authenticated", "iss": ISS, "exp": int(time.time()) + 300}
    claims.update(overrides)
    return claims


class _FakeJwks:
    """Ersetzt den JWKS-Abruf: liefert immer den öffentlichen Test-Schlüssel."""

    def get_signing_key_from_jwt(self, token):
        return SimpleNamespace(key=KEY.public_key())


def _app():
    app = FastAPI()

    @app.get("/whoami")
    def whoami(user_id: str = Depends(auth.current_user)):
        return {"user_id": user_id}

    return app


class TestTokenCheck(unittest.TestCase):
    def setUp(self):
        patches = [
            patch.object(auth, "SUPABASE_URL", "https://test.supabase.co"),
            patch.object(auth, "_jwk_client", lambda: _FakeJwks()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(_app())

    def _get(self, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.get("/whoami", headers=headers)

    def test_valid_token_returns_user_id_from_sub(self):
        token = jwt.encode(_claims(), KEY, algorithm="ES256")
        r = self._get(token)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"user_id": "user-1"})

    def test_missing_header_is_401(self):
        self.assertEqual(self._get().status_code, 401)

    def test_expired_token_is_401(self):
        token = jwt.encode(_claims(exp=int(time.time()) - 10), KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_wrong_audience_is_401(self):
        token = jwt.encode(_claims(aud="anon"), KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_wrong_issuer_is_401(self):
        token = jwt.encode(_claims(iss="https://evil.example/auth/v1"), KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_token_without_sub_is_401(self):
        claims = _claims()
        del claims["sub"]
        token = jwt.encode(claims, KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_wrong_signature_is_401(self):
        token = jwt.encode(_claims(), OTHER_KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_hs256_token_is_rejected(self):
        # Angriff: Token mit einem öffentlich bekannten Secret signieren.
        token = jwt.encode(_claims(), "secret", algorithm="HS256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_unsigned_token_is_rejected(self):
        token = jwt.encode(_claims(), None, algorithm="none")
        self.assertEqual(self._get(token).status_code, 401)


if __name__ == "__main__":
    unittest.main()
