"""Message texts must never appear in a log. The chat and phrase routes are checked in test_chats.py."""
import logging
import unittest
from unittest.mock import AsyncMock, patch

import msgpack
from fastapi.testclient import TestClient

import fish_tts
import main
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


class TestTtsLogsNoText(unittest.TestCase):
    def test_stream_tts_logs_lengths_but_never_the_text(self):
        ws = AsyncMock()
        ws.__aiter__.return_value = [
            msgpack.packb({"event": "audio", "audio": b"chunk"}),
            msgpack.packb({"event": "finish"}),
        ]
        main.app.dependency_overrides[current_user] = lambda: "user-1"
        try:
            with LogCapture() as logs, \
                 patch.object(fish_tts, "_take_warm_connection", AsyncMock(return_value=ws)):
                r = TestClient(main.app).get("/stream/tts", params={"text": f"Hallo {MARKER}"})
        finally:
            main.app.dependency_overrides.pop(current_user, None)

        self.assertEqual(r.status_code, 200)
        self.assertTrue(any("TTS finished" in line for line in logs.lines), logs.lines)
        self.assertFalse([line for line in logs.lines if MARKER in line])


if __name__ == "__main__":
    unittest.main()
