"""Integration tests for the voice clone endpoints (G3) against a real Postgres.

Locally: `npx supabase start`. In CI: a Postgres service container.
"""
import base64
import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import main
from auth import current_user
from testutils import TEST_DB, USER_A, USER_B, clear_user_data, prepare_schema


class _VoiceTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        prepare_schema()
        cls.enterClassContext(patch.dict(os.environ, {"DATABASE_URL": TEST_DB}))
        cls.client = cls.enterClassContext(TestClient(main.app))  # runs the lifespan: opens the pool
        cls.addClassCleanup(main.app.dependency_overrides.clear)

    def as_user(self, user_id):
        """Acts as a signed-in user (normally the id comes from the token)."""
        main.app.dependency_overrides[current_user] = lambda: user_id

    def setUp(self):
        clear_user_data()
        self.as_user(USER_A)

    def _upload(self, name="My voice", content=b"audio-bytes", consent="true", filename="sample.mp3"):
        return self.client.post(
            "/voice",
            data={"name": name, "consent": consent},
            files={"file": (filename, content, "audio/mpeg")},
        )


class TestVoiceEndpoints(_VoiceTestCase):
    def test_get_voice_is_null_initially(self):
        self.assertIsNone(self.client.get("/voice").json())

    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-new"))
    def test_upload_clones_and_stores_the_voice(self):
        r = self._upload()

        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["voiceId"], "voice-new")
        self.assertEqual(r.json()["name"], "My voice")
        self.assertGreater(r.json()["consentedAt"], 0)
        # The sample reached Mistral base64-encoded.
        main.mistral_tts.create_voice.assert_awaited_once()
        args, _ = main.mistral_tts.create_voice.call_args
        self.assertEqual(args[0].encode(), base64.b64encode(b"audio-bytes"))
        self.assertEqual(args[1], "sample.mp3")
        self.assertEqual(args[2], "My voice")

        # Stored for the next GET.
        self.assertEqual(self.client.get("/voice").json()["voiceId"], "voice-new")

    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-new"))
    def test_upload_without_consent_is_400(self):
        r = self._upload(consent="false")

        self.assertEqual(r.status_code, 400)
        main.mistral_tts.create_voice.assert_not_awaited()

    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-new"))
    def test_upload_with_blank_name_is_400(self):
        r = self._upload(name="   ")

        self.assertEqual(r.status_code, 400)
        main.mistral_tts.create_voice.assert_not_awaited()

    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-new"))
    def test_upload_empty_file_is_400(self):
        r = self._upload(content=b"")

        self.assertEqual(r.status_code, 400)
        main.mistral_tts.create_voice.assert_not_awaited()

    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-new"))
    def test_upload_too_large_is_413(self):
        with patch.object(main, "VOICE_MAX_BYTES", 4):
            r = self._upload(content=b"12345")

        self.assertEqual(r.status_code, 413)
        main.mistral_tts.create_voice.assert_not_awaited()

    @patch("mistral_tts.delete_voice", new=AsyncMock())
    @patch("mistral_tts.create_voice")
    def test_second_upload_replaces_the_old_voice(self, create_voice):
        create_voice.side_effect = ["voice-1", "voice-2"]

        self.assertEqual(self._upload().json()["voiceId"], "voice-1")
        r = self._upload(name="Second")

        self.assertEqual(r.json()["voiceId"], "voice-2")
        main.mistral_tts.delete_voice.assert_awaited_once_with("voice-1")
        # Only one row remains.
        self.assertEqual(self.client.get("/voice").json()["voiceId"], "voice-2")

    @patch("mistral_tts.delete_voice", new=AsyncMock())
    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-a"))
    def test_delete_removes_the_voice(self):
        self._upload()

        r = self.client.delete("/voice")

        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"status": "deleted"})
        main.mistral_tts.delete_voice.assert_awaited_once_with("voice-a")
        self.assertIsNone(self.client.get("/voice").json())

        # A second delete finds nothing.
        self.assertEqual(self.client.delete("/voice").status_code, 404)


class TestVoiceIsolation(_VoiceTestCase):
    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-a"))
    def test_other_user_cannot_see_or_delete_the_voice(self):
        self._upload()

        self.as_user(USER_B)
        self.assertIsNone(self.client.get("/voice").json())
        self.assertEqual(self.client.delete("/voice").status_code, 404)

        # USER_A's voice is untouched.
        self.as_user(USER_A)
        self.assertEqual(self.client.get("/voice").json()["voiceId"], "voice-a")


class TestAccountDeletion(_VoiceTestCase):
    @patch("mistral_tts.delete_voice", new=AsyncMock())
    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-a"))
    @patch("main.delete_supabase_user", new=AsyncMock())
    def test_delete_account_deletes_the_user_and_the_voice(self):
        self._upload()

        r = self.client.delete("/account")

        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"status": "deleted"})
        main.delete_supabase_user.assert_awaited_once_with(USER_A)
        main.mistral_tts.delete_voice.assert_awaited_once_with("voice-a")

    @patch("mistral_tts.delete_voice", new=AsyncMock())
    @patch("main.delete_supabase_user", new=AsyncMock())
    def test_delete_account_without_voice_still_deletes_the_user(self):
        r = self.client.delete("/account")

        self.assertEqual(r.status_code, 200, r.text)
        main.delete_supabase_user.assert_awaited_once_with(USER_A)
        main.mistral_tts.delete_voice.assert_not_awaited()

    @patch("mistral_tts.delete_voice", new=AsyncMock())
    @patch("mistral_tts.create_voice", new=AsyncMock(return_value="voice-a"))
    @patch("main.delete_supabase_user", new=AsyncMock(side_effect=Exception("boom")))
    def test_delete_account_fails_when_supabase_fails(self):
        self._upload()

        r = self.client.delete("/account")

        self.assertEqual(r.status_code, 502)
        main.mistral_tts.delete_voice.assert_not_awaited()
