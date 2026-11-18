"""Maps emojis to Voxtral emotion tags, e.g. "[emotion=happy]Text".

Valid emotion values: https://docs.mistral.ai/studio/audio/text-to-speech/emotion-tags
"""
import re

# Still open which emoji means which emotion. Fill this in later, e.g.:
#   "😊": "happy",
#   "😢": "sad",
EMOJI_TO_EMOTION: dict[str, str] = {}

# Variation selector: "❤️" and "❤" should match the same key.
_VARIATION_SELECTOR = "️"


def _normalize(emoji: str) -> str:
    return emoji.replace(_VARIATION_SELECTOR, "")


def apply_emotion_tags(text: str) -> str:
    """Replaces each mapped emoji with its [emotion=...] tag. Unmapped emojis and text stay unchanged."""
    if not EMOJI_TO_EMOTION:
        return text

    lookup = {_normalize(e): v for e, v in EMOJI_TO_EMOTION.items()}
    # Longest first, so multi-codepoint emojis win over their parts.
    keys = sorted(lookup, key=len, reverse=True)
    pattern = re.compile(
        "(?:" + "|".join(re.escape(k) for k in keys) + ")" + _VARIATION_SELECTOR + "?"
    )
    return pattern.sub(lambda m: f"[emotion={lookup[_normalize(m.group(0))]}]", text)
