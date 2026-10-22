"""Rate-Limit pro Nutzer (G5): Nutzer hinter derselben IP teilen sich kein Limit.

Läuft mit echter Token-Prüfung (eigenes Schlüsselpaar wie in test_auth.py) und dem
Mock-TTS, braucht also weder Datenbank noch Fish Audio.
"""
import os
import time
import unittest
from unittest.mock import patch

import jwt
from fastapi import Request
from fastapi.testclient import TestClient

import auth
import main
import mock_tts
from test_auth import ISS, KEY, _claims, _FakeJwks

FAST_MOCK = {"MOCK_TTS_FIRST_AUDIO_MS": "0", "MOCK_TTS_CHUNK_MS": "0"}


def _token(user_id: str) -> dict:
    token = jwt.encode(_claims(sub=user_id), KEY, algorithm="ES256")
    return {"Authorization": f"Bearer {token}"}


class RateLimitCase(unittest.TestCase):
    LIMIT = "3/minute"

    def setUp(self):
        patches = [
            patch.object(main, "TTS_PROVIDER", "mock"),
            patch.object(auth, "SUPABASE_URL", ISS.removesuffix("/auth/v1")),
            patch.object(auth, "_jwk_client", lambda: _FakeJwks()),
            patch.dict(os.environ, {**FAST_MOCK, "RATE_LIMIT_TTS": self.LIMIT}),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        main.limiter.reset()
        self.addCleanup(main.limiter.reset)

    def speak(self, client, user_id):
        return client.get("/stream/tts", params={"text": "Hallo"}, headers=_token(user_id)).status_code


class TestPerUser(RateLimitCase):
    def test_users_behind_the_same_ip_have_separate_limits(self):
        client = TestClient(main.app)  # beide Nutzer kommen von derselben IP
        self.assertEqual([self.speak(client, "user-a") for _ in range(4)], [200, 200, 200, 429])
        # Nutzer A ist am Limit, Nutzer B merkt nichts davon.
        self.assertEqual([self.speak(client, "user-b") for _ in range(4)], [200, 200, 200, 429])

    def test_the_same_user_on_two_ips_shares_one_limit(self):
        phone = TestClient(main.app, client=("10.0.0.1", 1111))
        tablet = TestClient(main.app, client=("10.0.0.2", 2222))
        self.assertEqual([self.speak(phone, "user-a") for _ in range(2)], [200, 200])
        self.assertEqual([self.speak(tablet, "user-a") for _ in range(2)], [200, 429])

    def test_requests_without_a_valid_token_get_401_and_use_up_no_limit(self):
        client = TestClient(main.app)
        bad = [client.get("/stream/tts", params={"text": "x"}).status_code for _ in range(6)]
        fake = [client.get("/stream/tts", params={"text": "x"},
                           headers={"Authorization": "Bearer fake"}).status_code for _ in range(6)]
        self.assertEqual(set(bad + fake), {401})  # nie 429
        self.assertEqual(self.speak(client, "user-a"), 200)  # und nichts verbraucht

    def test_a_forged_token_cannot_use_up_another_users_limit(self):
        client = TestClient(main.app)
        forged = jwt.encode(_claims(sub="user-a"), "not-the-real-key", algorithm="HS256")
        for _ in range(6):
            client.get("/stream/tts", params={"text": "x"}, headers={"Authorization": f"Bearer {forged}"})
        self.assertEqual([self.speak(client, "user-a") for _ in range(3)], [200, 200, 200])


class TestConfiguration(RateLimitCase):
    def test_limit_comes_from_the_environment_on_every_request(self):
        client = TestClient(main.app)
        with patch.dict(os.environ, {"RATE_LIMIT_TTS": "1/minute"}):
            self.assertEqual([self.speak(client, "user-a") for _ in range(2)], [200, 429])
        main.limiter.reset()
        with patch.dict(os.environ, {"RATE_LIMIT_TTS": "100/minute"}):
            self.assertEqual({self.speak(client, "user-a") for _ in range(10)}, {200})

    def test_default_is_30_per_minute_per_user(self):
        with patch.dict(os.environ):
            os.environ.pop("RATE_LIMIT_TTS")
            self.assertEqual(main._tts_rate_limit(), "30/minute")

    def test_a_user_can_speak_again_after_the_window(self):
        client = TestClient(main.app)
        with patch.dict(os.environ, {"RATE_LIMIT_TTS": "2/second"}):
            self.assertEqual([self.speak(client, "user-a") for _ in range(3)], [200, 200, 429])
            time.sleep(1.1)
            self.assertEqual(self.speak(client, "user-a"), 200)


class TestKeyFunction(unittest.TestCase):
    def _request(self, user_id=None, host="1.2.3.4"):
        scope = {"type": "http", "client": (host, 1), "headers": [], "method": "GET", "path": "/"}
        request = Request(scope)
        if user_id:
            request.state.user_id = user_id
        return request

    def test_verified_user_wins_over_ip(self):
        self.assertEqual(main.rate_limit_key(self._request("u1", "1.1.1.1")),
                         main.rate_limit_key(self._request("u1", "2.2.2.2")))
        self.assertNotEqual(main.rate_limit_key(self._request("u1")), main.rate_limit_key(self._request("u2")))

    def test_without_a_user_the_ip_is_used(self):
        self.assertEqual(main.rate_limit_key(self._request(host="9.9.9.9")), "ip:9.9.9.9")
        self.assertNotEqual(main.rate_limit_key(self._request(host="9.9.9.9")),
                            main.rate_limit_key(self._request(host="8.8.8.8")))


if __name__ == "__main__":
    unittest.main()
