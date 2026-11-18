"""Maps emojis in the user text to Voxtral emotion tags.

Voxtral syntax: "[emotion=happy]Text". A tag is not spoken and applies until
the next tag or the end of the input. Unknown values are ignored by the API.
Docs: https://docs.mistral.ai/studio/audio/text-to-speech/emotion-tags
Valid emotions (34): amused, angry, anxious, apologetic, appreciative,
assertive, bored, calm, confident, confused, critical, curious, determined,
disappointed, disgusted, excited, frustrated, grateful, happy, hopeful,
playful, proud, reflective, resigned, sad, sarcastic, skeptical, somber,
surprised, tense, tired, urgent, warm, wistful.
Pace values: very-slow, slow, moderate, fast, very-fast (tag: [pace=slow]).
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
