"""Every route without a valid token answers 401.

The routes are read from the app itself, so a new route without a token check fails this test.
"""
import os
import re
import unittest
from unittest.mock import patch

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

import main

# Public on purpose: used by the app and the Docker health check, has no user data.
PUBLIC_ROUTES = {("GET", "/health")}


def _all_routes():
    for route in main.app.routes:
        if isinstance(route, APIRoute):
            for method in sorted(route.methods - {"HEAD"}):
                yield method, route.path


def _url(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", path)  # fill path parameters with a placeholder


class TestEveryRouteNeedsAToken(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)  # no "with": no lifespan, so no database

    def test_route_list_is_read_correctly(self):
        # Makes sure the tests below do not silently check an empty list.
        found = set(_all_routes())
        for expected in [
            ("GET", "/chats"), ("PUT", "/chats/{chat_id}"), ("DELETE", "/chats/{chat_id}"),
            ("GET", "/phrases"), ("PUT", "/phrases"),
            ("GET", "/stats/tts"), ("POST", "/stats/tts"),
            ("GET", "/stream/tts"), ("GET", "/warmup"),
            ("GET", "/voice"), ("POST", "/voice"), ("DELETE", "/voice"),
            ("GET", "/metrics"), ("GET", "/health"),
        ]:
            self.assertIn(expected, found)

    def test_every_non_public_route_returns_401_without_token(self):
        for method, path in _all_routes():
            if (method, path) in PUBLIC_ROUTES:
                continue
            with self.subTest(route=f"{method} {path}"):
                r = self.client.request(method, _url(path), json={})
                self.assertEqual(r.status_code, 401, r.text)

    def test_every_non_public_route_returns_401_with_a_fake_token(self):
        headers = {"Authorization": "Bearer not-a-real-token"}
        for method, path in _all_routes():
            if (method, path) in PUBLIC_ROUTES:
                continue
            with self.subTest(route=f"{method} {path}"):
                r = self.client.request(method, _url(path), json={}, headers=headers)
                self.assertEqual(r.status_code, 401, r.text)


class TestMetricsToken(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def _get(self, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.get("/metrics", headers=headers)

    def test_metrics_closed_when_no_token_is_configured(self):
        with patch.dict(os.environ, {"METRICS_TOKEN": ""}):
            self.assertEqual(self._get("anything").status_code, 401)

    def test_wrong_token_is_401(self):
        with patch.dict(os.environ, {"METRICS_TOKEN": "right-token"}):
            self.assertEqual(self._get("wrong-token").status_code, 401)
            self.assertEqual(self._get().status_code, 401)

    def test_correct_token_returns_metrics(self):
        with patch.dict(os.environ, {"METRICS_TOKEN": "right-token"}):
            r = self._get("right-token")
        self.assertEqual(r.status_code, 200)
        self.assertIn("# HELP", r.text)


if __name__ == "__main__":
    unittest.main()
