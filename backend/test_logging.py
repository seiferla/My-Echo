"""Message texts must never appear in a log. The chat and phrase routes are checked in test_chats.py."""
import base64
import logging
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

import main
import mistral_tts
from auth import current_user
from testutils import MARKER, LogCapture


class TestAccessLogFilter(unittest.TestCase):
    def test_query_string_is_removed_from_the_access_log(self):
        # The same arguments Uvicorn uses: (client, method, path?query, http_version, status)
        record = logging.LogRecord(
            "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1:5000", "GET", f"/stream/tts?text={MARKER}", "1.1", 200), None,
        )
        main.StripQueryFromAccessLog().filter(record)
        line = record.getMessage()
        self.assertNotIn(MARKER, line)
        self.assertIn("/stream/tts", line)

    def test_filter_is_installed_on_the_uvicorn_access_logger(self):
        filters = logging.getLogger("uvicorn.access").filters
        self.assertTrue(any(isinstance(f, main.StripQueryFromAccessLog) for f in filters))


class _FakeStreamResponse:
    """Fake SSE response for mistral_tts.stream()."""

    def __init__(self, chunks):
        self._lines = []
        for c in chunks:
            b64 = base64.b64encode(c).decode()
            self._lines.append(f'data: {{"type": "speech.audio.delta", "audio_data": "{b64}"}}')
            self._lines.append("")
        self._lines.append('data: {"type": "speech.audio.done", "usage": {}}')
        self._lines.append("")

    def raise_for_status(self):
        pass

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class TestTtsLogsNoText(unittest.TestCase):
    def test_stream_tts_logs_lengths_but_never_the_text(self):
        fake_response = _FakeStreamResponse([b"chunk"])

        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False
        stream_cm = AsyncMock()
        stream_cm.__aenter__.return_value = fake_response
        stream_cm.__aexit__.return_value = False
        mock_client.stream = MagicMock(return_value=stream_cm)

        main.app.dependency_overrides[current_user] = lambda: "user-1"
        try:
            with LogCapture() as logs, \
                 patch("mistral_tts.httpx.AsyncClient", MagicMock(return_value=mock_client)):
                r = TestClient(main.app).get("/stream/tts", params={"text": f"Hallo {MARKER}"})
        finally:
            main.app.dependency_overrides.pop(current_user, None)

        self.assertEqual(r.status_code, 200)
        self.assertTrue(any("TTS finished" in line for line in logs.lines), logs.lines)
        self.assertFalse([line for line in logs.lines if MARKER in line])


if __name__ == "__main__":
    unittest.main()
