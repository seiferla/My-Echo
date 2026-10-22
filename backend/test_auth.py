"""Tests for the token check in auth.py. No database and no network needed."""
import time
import unittest
from unittest.mock import patch

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

import auth
from testutils import ISS, KEY, OTHER_KEY, FakeJwks, make_claims


def _app():
    app = FastAPI()

    @app.get("/whoami")
    def whoami(user_id: auth.CurrentUser):
        return {"user_id": user_id}

    return app


class TestTokenCheck(unittest.TestCase):
    def setUp(self):
        patches = [
            patch.object(auth, "SUPABASE_URL", ISS.removesuffix("/auth/v1")),
            patch.object(auth, "_jwk_client", FakeJwks),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(_app())

    def _get(self, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.get("/whoami", headers=headers)

    def test_valid_token_returns_user_id_from_sub(self):
        token = jwt.encode(make_claims(), KEY, algorithm="ES256")
        r = self._get(token)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"user_id": "user-1"})

    def test_missing_header_is_401(self):
        self.assertEqual(self._get().status_code, 401)

    def test_expired_token_is_401(self):
        token = jwt.encode(make_claims(exp=int(time.time()) - 10), KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_wrong_audience_is_401(self):
        token = jwt.encode(make_claims(aud="anon"), KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_wrong_issuer_is_401(self):
        token = jwt.encode(make_claims(iss="https://evil.example/auth/v1"), KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_token_without_sub_is_401(self):
        claims = make_claims()
        del claims["sub"]
        token = jwt.encode(claims, KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_wrong_signature_is_401(self):
        token = jwt.encode(make_claims(), OTHER_KEY, algorithm="ES256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_hs256_token_is_rejected(self):
        # Attack: sign the token with a publicly known secret.
        token = jwt.encode(make_claims(), "secret", algorithm="HS256")
        self.assertEqual(self._get(token).status_code, 401)

    def test_unsigned_token_is_rejected(self):
        token = jwt.encode(make_claims(), None, algorithm="none")
        self.assertEqual(self._get(token).status_code, 401)


if __name__ == "__main__":
    unittest.main()
