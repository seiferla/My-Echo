"""Locust scenario for myEcho: each simulated user does what the app does.

Tokens are issued before the run (prepare.py), so there are no logins during the test.
Texts and waiting times are deterministic per user (LOADTEST_SEED). Names in the CSV
are explained in README.md.
"""
import itertools
import json
import os
import random
import time

from locust import HttpUser, task

_tokens: list | None = None
SEED = int(os.getenv("LOADTEST_SEED", "42"))
THINK_MIN = float(os.getenv("LOADTEST_THINK_MIN", "10"))
THINK_MAX = float(os.getenv("LOADTEST_THINK_MAX", "20"))
RELOAD_EVERY = int(os.getenv("LOADTEST_RELOAD_EVERY", "2"))

_next_user = itertools.count()


def tokens() -> list:
    """Loaded on first use, not on import, so the tests can import this module."""
    global _tokens
    if _tokens is None:
        with open(os.environ["LOADTEST_TOKENS"]) as f:
            _tokens = json.load(f)
    return _tokens


WORDS = (  # noqa: SIM905 (one string is easier to read and edit)
    "ja nein danke bitte hallo gut heute morgen später Hilfe Wasser Essen Arzt Licht Fenster Tür "
    "ich du wir mir mein dein kann will brauche möchte habe bin ist sind kommst gehst warte "
    "schreibe verstehe langsam schnell nochmal etwas bitte jetzt gleich Moment Pause Besuch "
    "Familie Freunde Telefon Fernseher Decke Kissen Tee Kaffee Brot Suppe müde Schmerzen kalt warm"
).split()


def make_text(rng: random.Random) -> str:
    """50 % short (up to 20 chars), 35 % medium (up to 80), 15 % long (up to 200), as in goals.md."""
    pick = rng.random()
    limit = 20 if pick < 0.50 else 80 if pick < 0.85 else 200
    target = rng.randint(2 if limit == 20 else limit // 2, limit)
    words: list[str] = []
    while True:
        word = rng.choice(WORDS)
        if len(" ".join(words + [word])) > target:
            break
        words.append(word)
    return (" ".join(words) or rng.choice(WORDS))[:limit]


class AppUser(HttpUser):
    def wait_time(self):
        return self.rng.uniform(THINK_MIN, THINK_MAX)

    def on_start(self):
        slot = next(_next_user)
        if slot >= len(tokens()):
            raise RuntimeError(f"{slot + 1} users but only {len(tokens())} tokens: run prepare.py with more users")
        who = tokens()[slot]
        self.index = who["index"]
        self.rng = random.Random(SEED * 1000 + self.index)
        self.auth = {"Authorization": f"Bearer {who['token']}"}
        self.chat_id = f"lt-{self.index:03d}"
        self.marker = f"LT{self.index:03d}-"
        self.messages: list[dict] = []
        self.rounds = 0
        self.load_chats()

    def load_chats(self):
        self.client.get("/chats", headers=self.auth, name="/chats GET")

    def save_chat(self, text: str):
        self.messages.append({
            "id": f"{self.chat_id}-m{len(self.messages)}",
            "role": "user",
            "content": f"{self.marker}{len(self.messages):04d}: {text}",
            "via": "send",
        })
        chat = {"id": self.chat_id, "title": f"Lasttest {self.index}", "timestamp": int(time.time() * 1000),
                "pinned": False, "messages": self.messages}
        with self.client.put(f"/chats/{self.chat_id}", json=chat, headers=self.auth,
                             name="/chats PUT", catch_response=True) as r:
            if r.status_code != 200:
                self.messages.pop()  # not saved, so the isolation check must not expect it
                r.failure(f"HTTP {r.status_code}")

    def speak(self, text: str):
        events = self.environment.events
        start = time.perf_counter()
        with self.client.get("/stream/tts", params={"text": text}, headers=self.auth, stream=True,
                             name="/stream/tts [headers]", catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"HTTP {r.status_code}")
                return
            mock_delay = int(r.headers.get("X-TTS-Mock-First-Audio-Ms", "0"))
            first_ms = None
            size = 0
            for chunk in r.iter_content(chunk_size=4096):
                if first_ms is None:
                    first_ms = (time.perf_counter() - start) * 1000
                size += len(chunk)
            total_ms = (time.perf_counter() - start) * 1000
            if first_ms is None:
                r.failure("empty audio")
                return
            r.success()

        def report(name, ms, length=0):
            events.request.fire(request_type="TTS", name=name, response_time=ms,
                                response_length=length, exception=None, context={})
        report("/stream/tts [first audio byte]", first_ms)
        report("/stream/tts [overhead]", max(0.0, first_ms - mock_delay))
        report("/stream/tts [total]", total_ms, size)

    @task
    def send_message(self):
        text = make_text(self.rng)
        self.save_chat(text)
        self.speak(text)
        self.rounds += 1
        # Reload regularly: the first load is in the ramp-up, whose values Locust discards.
        if self.rounds % RELOAD_EVERY == 0:
            self.load_chats()

    def on_stop(self):
        # run_baseline.py checks isolation afterwards with this state. It cannot use Locust's
        # CSV, because Locust writes it before these last requests are done.
        state_dir = os.getenv("LOADTEST_STATE_DIR")
        if state_dir:
            os.makedirs(state_dir, exist_ok=True)
            with open(os.path.join(state_dir, f"user-{self.index:03d}.json"), "w") as f:
                json.dump({"index": self.index, "saved_messages": len(self.messages)}, f)
