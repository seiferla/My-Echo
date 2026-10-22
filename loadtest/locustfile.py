"""Locust-Szenario für myEcho (Issue #218, Ziel G5). Methode: docs/goals.md.

Ein simulierter Nutzer macht, was die App macht:
  1. beim Start die Chats laden
  2. alle 10 bis 20 s eine Nachricht senden: Chat speichern (PUT) und sprechen (GET /stream/tts)
  3. jede zweite Runde die Chats neu laden, damit es Messwerte im Messfenster gibt
     (der Start liegt in der Anlaufzeit, deren Werte Locust verwirft)
Am Ende hält jeder Nutzer fest, wie viele Nachrichten er gespeichert hat. Danach prüft
der Ablauf (run_baseline.py), dass jeder Nutzer nur seine eigenen Daten sieht.

Die Tokens werden vorher ausgestellt (prepare.py), es gibt keine Anmeldungen im Test.
Texte und Wartezeiten sind pro Nutzer deterministisch (LOADTEST_SEED).

Messwerte und ihre Namen in der CSV:
  /chats GET                      Chats laden
  /chats PUT                      Chat speichern
  /stream/tts [headers]           Zeit bis zu den Antwort-Köpfen (kommen sofort, nur zur Info)
  /stream/tts [first audio byte]  Zeit bis zum ersten Byte AUDIO (die Zahl, die zählt)
  /stream/tts [overhead]          dasselbe minus Wartezeit des Mocks = Aufwand des eigenen Systems
  /stream/tts [total]             Zeit bis das ganze Audio da ist
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
    """Erst beim Start laden (nicht beim Import), damit die Tests dieses Modul importieren können."""
    global _tokens
    if _tokens is None:
        _tokens = json.load(open(os.environ["LOADTEST_TOKENS"]))
    return _tokens

WORDS = (
    "ja nein danke bitte hallo gut heute morgen später Hilfe Wasser Essen Arzt Licht Fenster Tür "
    "ich du wir mir mein dein kann will brauche möchte habe bin ist sind kommst gehst warte "
    "schreibe verstehe langsam schnell nochmal etwas bitte jetzt gleich Moment Pause Besuch "
    "Familie Freunde Telefon Fernseher Decke Kissen Tee Kaffee Brot Suppe müde Schmerzen kalt warm"
).split()


def make_text(rng: random.Random) -> str:
    """50 % kurz (bis 20 Zeichen), 35 % mittel (bis 80), 15 % lang (bis 200), wie in goals.md."""
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

    # --- die einzelnen Aufrufe -------------------------------------------------

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
                self.messages.pop()  # Speichern fehlgeschlagen: Nachricht zählt nicht
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

    # --- eine Runde: Nachricht senden ------------------------------------------

    @task
    def send_message(self):
        text = make_text(self.rng)
        self.save_chat(text)
        self.speak(text)
        self.rounds += 1
        if self.rounds % RELOAD_EVERY == 0:
            self.load_chats()


    # --- Ende: Zustand für die Datentrennungs-Prüfung festhalten ----------------
    # Geprüft wird danach vom Ablauf (run_baseline.py), unabhängig von Locust: Locust schreibt
    # seine CSV, bevor die Abschlussanfragen der Nutzer fertig sind.

    def on_stop(self):
        state_dir = os.getenv("LOADTEST_STATE_DIR")
        if state_dir:
            os.makedirs(state_dir, exist_ok=True)
            with open(os.path.join(state_dir, f"user-{self.index:03d}.json"), "w") as f:
                json.dump({"index": self.index, "saved_messages": len(self.messages)}, f)
