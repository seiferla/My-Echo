"""Tests for auth.py: token check and account deletion. No database and no network needed."""
import time
import unittest
from unittest.mock import patch

import httpx
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


class TestDeleteSupabaseUser(unittest.IsolatedAsyncioTestCase):
    """The admin call that deletes the auth user (the database rows follow via CASCADE)."""

    SUPABASE = "https://test.supabase.co"
    SERVICE_KEY = "service-role-test-key"

    def setUp(self):
        self.requests: list[httpx.Request] = []
        self.status = 200
        for p in [
            patch.object(auth, "SUPABASE_URL", self.SUPABASE),
            patch.object(auth, "SUPABASE_SERVICE_ROLE_KEY", self.SERVICE_KEY),
            # Every AsyncClient in auth.py talks to this fake instead of the network.
            patch.object(auth.httpx, "AsyncClient", self._client_with_fake_transport()),
        ]:
            p.start()
            self.addCleanup(p.stop)

    def _client_with_fake_transport(self):
        real_client = httpx.AsyncClient

        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return httpx.Response(self.status)

        return lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)

    async def test_sends_delete_to_the_admin_api_with_the_service_role_key(self):
        await auth.delete_supabase_user("user-1")

        self.assertEqual(len(self.requests), 1)
        request = self.requests[0]
        self.assertEqual(request.method, "DELETE")
        self.assertEqual(str(request.url), f"{self.SUPABASE}/auth/v1/admin/users/user-1")
        self.assertEqual(request.headers["apikey"], self.SERVICE_KEY)
        self.assertEqual(request.headers["Authorization"], f"Bearer {self.SERVICE_KEY}")

    async def test_raises_when_supabase_answers_with_an_error(self):
        # The /account route turns this into a 502, so the app does not report success.
        self.status = 500

        with self.assertRaises(httpx.HTTPStatusError):
            await auth.delete_supabase_user("user-1")

    async def test_refuses_to_run_without_configuration(self):
        for missing in ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]:
            with self.subTest(missing=missing), patch.object(auth, missing, ""):
                with self.assertRaises(RuntimeError):
                    await auth.delete_supabase_user("user-1")

        self.assertEqual(self.requests, [])


if __name__ == "__main__":
    unittest.main()
