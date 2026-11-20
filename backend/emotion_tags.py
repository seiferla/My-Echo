"""Maps emojis to Voxtral emotion tags, e.g. "[emotion=happy]Text".

Valid emotion values: https://docs.mistral.ai/studio/audio/text-to-speech/emotion-tags
"""
import re

# No emoji (yet): playful, excited, skeptical, somber, wistful.
EMOJI_TO_EMOTION: dict[str, str] = {
    "🥳": "happy",
    "😔": "sad",
    "😠": "angry",
    "🙂": "calm",
    "🙏": "grateful",
    "🤝": "apologetic",
    "😳": "surprised",
    "❤": "warm",
    "‼": "urgent",
    "🥱": "tired",
    "🤨": "sarcastic",
    "🙃": "confused",
    "💃": "amused",
    "😨": "anxious",
    "👏": "appreciative",
    "🫵": "assertive",
    "🙄": "bored",
    "💪": "confident",
    "🤔": "critical",
    "🤥": "curious",
    "👍": "determined",
    "😞": "disappointed",
    "🤢": "disgusted",
    "🫩": "frustrated",
    "😄": "hopeful",
    "☺": "proud",
    "🧐": "reflective",
    "😓": "resigned",
    "😬": "tense",
}

# Ignored when matching, so "❤️" = "❤" and "🙏🏻" = "🙏":
# variation selector (U+FE0F) and skin tone modifiers (U+1F3FB-U+1F3FF).
_IGNORED = "️\U0001F3FB-\U0001F3FF"
_IGNORED_RE = re.compile(f"[{_IGNORED}]")


def _normalize(emoji: str) -> str:
    return _IGNORED_RE.sub("", emoji)


def apply_emotion_tags(text: str) -> str:
    """Replaces each mapped emoji with its [emotion=...] tag. Unmapped emojis and text stay unchanged."""
    if not EMOJI_TO_EMOTION:
        return text

    lookup = {_normalize(e): v for e, v in EMOJI_TO_EMOTION.items()}
    # Longest first, so multi-codepoint emojis win over their parts.
    keys = sorted(lookup, key=len, reverse=True)
    pattern = re.compile(
        "(?:" + "|".join(re.escape(k) for k in keys) + f")[{_IGNORED}]*"
    )
    return pattern.sub(lambda m: f"[emotion={lookup[_normalize(m.group(0))]}]", text)
