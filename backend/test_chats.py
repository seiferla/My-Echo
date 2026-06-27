"""Integration-Tests für die Chat-Endpoints — laufen gegen eine in-memory
SQLite, brauchen keinen Datei-Mount. Decken Roundtrip, Upsert-Verhalten und
Fehlerfälle ab."""
import os
os.environ["DB_PATH"] = ":memory:"

import unittest
from fastapi.testclient import TestClient

import main


class TestChatsEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # TestClient startet lifespan, init_db() läuft
        cls.client = TestClient(main.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def setUp(self):
        # Vor jedem Test alle Chats löschen — ":memory:" lebt über die App-Lifespan
        for c in self.client.get("/chats").json():
            self.client.delete(f"/chats/{c['id']}")

    def _chat(self, chat_id="c1", msg_count=2):
        return {
            "id": chat_id,
            "title": "Test",
            "timestamp": 1_700_000_000_000,
            "pinned": False,
            "messages": [
                {
                    "id": f"m{i}",
                    "role": "user" if i % 2 == 0 else "assistant",
                    "content": f"msg {i}",
                    "via": "send",
                }
                for i in range(msg_count)
            ],
        }

    def test_empty_initially(self):
        self.assertEqual(self.client.get("/chats").json(), [])

    def test_put_then_get_roundtrip(self):
        chat = self._chat()
        r = self.client.put(f"/chats/{chat['id']}", json=chat)
        self.assertEqual(r.status_code, 200)

        result = self.client.get("/chats").json()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "c1")
        self.assertEqual(len(result[0]["messages"]), 2)
        self.assertEqual(result[0]["messages"][0]["content"], "msg 0")

    def test_put_replaces_messages(self):
        self.client.put("/chats/c1", json=self._chat(msg_count=3))
        self.client.put("/chats/c1", json=self._chat(msg_count=1))
        result = self.client.get("/chats").json()
        self.assertEqual(len(result[0]["messages"]), 1)

    def test_delete(self):
        self.client.put("/chats/c1", json=self._chat())
        r = self.client.delete("/chats/c1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get("/chats").json(), [])

    def test_delete_unknown_returns_404(self):
        self.assertEqual(self.client.delete("/chats/ghost").status_code, 404)

    def test_url_body_id_mismatch(self):
        chat = self._chat(chat_id="real")
        r = self.client.put("/chats/different", json=chat)
        self.assertEqual(r.status_code, 400)
