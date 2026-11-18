import unittest
from unittest.mock import patch

import emotion_tags
import mistral_tts


class ApplyEmotionTagsTest(unittest.TestCase):
    def test_empty_mapping_leaves_text_unchanged(self):
        with patch.dict(emotion_tags.EMOJI_TO_EMOTION, {}, clear=True):
            self.assertEqual(emotion_tags.apply_emotion_tags("Hallo 😊"), "Hallo 😊")

    def test_replaces_mapped_emoji(self):
        with patch.dict(emotion_tags.EMOJI_TO_EMOTION, {"😊": "happy"}, clear=True):
            self.assertEqual(
                emotion_tags.apply_emotion_tags("😊 Wir haben es geschafft"),
                "[emotion=happy] Wir haben es geschafft",
            )

    def test_unmapped_emoji_stays(self):
        with patch.dict(emotion_tags.EMOJI_TO_EMOTION, {"😊": "happy"}, clear=True):
            self.assertEqual(emotion_tags.apply_emotion_tags("Hi 😢"), "Hi 😢")

    def test_variation_selector_is_ignored(self):
        with patch.dict(emotion_tags.EMOJI_TO_EMOTION, {"❤": "warm"}, clear=True):
            self.assertEqual(emotion_tags.apply_emotion_tags("Danke ❤️"), "Danke [emotion=warm]")

    def test_multiple_emojis_in_one_text(self):
        mapping = {"😊": "happy", "😢": "sad"}
        with patch.dict(emotion_tags.EMOJI_TO_EMOTION, mapping, clear=True):
            self.assertEqual(
                emotion_tags.apply_emotion_tags("😊 Gut. 😢 Schade."),
                "[emotion=happy] Gut. [emotion=sad] Schade.",
            )

    def test_payload_uses_mapping(self):
        with patch.dict(emotion_tags.EMOJI_TO_EMOTION, {"😊": "happy"}, clear=True):
            self.assertEqual(mistral_tts._payload("😊 Hallo")["input"], "[emotion=happy] Hallo")


if __name__ == "__main__":
    unittest.main()
