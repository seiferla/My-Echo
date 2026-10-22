<div align="center">

🌐 **English** | [Deutsch](README.de.md)

# myEcho

## *"Giving a voice back to those who lost theirs."*

<br/>

**Assistive communication app for people with voice disorders.**

Type what you want to say — myEcho speaks it in your own voice.

[**Website**](https://seiferla.github.io/My-Echo/app/) · [**Voice cloning evaluation**](https://github.com/seiferla/als-voice-cloning-evaluation)

<br/>

![Expo](https://img.shields.io/badge/Expo-58-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.88-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-24_LTS-339933?logo=node.js&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.146-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)
![Pydantic](https://img.shields.io/badge/Pydantic-2.14-E92063?logo=pydantic&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?logo=android&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)
![Backend Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/seiferla/6a78432e927c4d553d55828c74b8859d/raw/myecho-coverage.json)

</div>

---

## Table of Contents

- [About](#about)
- [Demo](#demo)
- [How It Works](#how-it-works)
- [Performance](#performance)
- [Project Structure](#project-structure)
- [Mobile App](#mobile-app)
- [Backend](#backend)
- [Monitoring](#monitoring)
- [Status](#status)

---

## About

**myEcho is built for people who can no longer use their own voice.**

The project started when my mother was diagnosed with ALS in its bulbar form. The muscles for speaking weaken first, so today she can hardly speak clearly. Most voice cloning solutions need several minutes of studio recordings — her voice was already too unstable for that. Because the TTS model works zero-shot, **30 seconds from old WhatsApp voice messages**, recorded long before her illness, were enough to recreate her voice.

She has been using myEcho in her daily life for several months: she types what she wants to say, and the app speaks it in her old voice. The interface is calm and simple on purpose — no friction, no complexity.

The models behind this were compared in a separate university project: [als-voice-cloning-evaluation](https://github.com/seiferla/als-voice-cloning-evaluation).

---

## Demo

<div align="center">

<img src="docs/demo.gif" alt="myEcho in action — typing a message and having it spoken aloud" width="260" />

</div>

---

## How It Works

<div align="center">

![myEcho architecture diagram](docs/myecho-architecture.svg)

</div>

> Diagram source: [`docs/architecture.puml`](docs/architecture.puml) (PlantUML). Regenerate with `java -jar plantuml.jar -tsvg docs/architecture.puml`.

1. User opens the compose field → backend pre-warms the Fish Audio connection
2. In **Schnell** mode (default), finished sentences are already synthesized while the user types; in **Eco** mode, synthesis starts only on send
3. User taps Send → the first sentence starts playing; the remaining sentences are prepared while it plays
4. App checks the on-device audio cache → cache hit plays instantly from local file
5. Cache miss: app requests audio via HTTP streaming from the self-hosted backend
6. Backend forwards text to Fish Audio and streams MP3 chunks back in real time
7. The MP3 is stored in the device cache so the next playback of the same phrase is instant
8. If the backend is unreachable, the app falls back to local speech synthesis automatically

Chats sync independently of audio: on startup the app **merges** backend and local chats, so history is never overwritten and survives a reinstall. Offline changes are synced on the next reachable start.

---

## Performance

In a conversation, the key number is **time to first audio (TTFA)**: the time from pressing *Send* until the first sound. Every second of silence interrupts the conversation partner.

People who use an AAC app type slowly, and the network is idle during that time. myEcho uses this time to **pre-synthesize finished sentences while the user types**, and then plays long messages **sentence by sentence**.

**TTFA for 10 messages of ~30 words** (Android emulator, debug build, cloud TTS):

| Mode | Ø TTFA |
|---|---|
| Before: whole text synthesized after send | **3506 ms** |
| Sentence by sentence, synthesis after send (*Eco*) | 2274 ms |
| Pre-synthesis while typing (*Schnell*) | **~100 ms** |
| Best case: whole text already cached | 85 ms |

- Long messages start about **30× faster** (~3.5 s → ~0.1 s), close to a cache hit.
- Even in *Eco* mode, long messages start ~35 % faster, with no extra requests.
- The next sentence is preloaded while the current one plays, so the gap between sentences is only 19–43 ms (not audible).

Details, edit handling and raw data: [ADR 0001 — Sentence pre-synthesis while typing](docs/adr/0001-sentence-presynthesis.md).

---

## Project Structure

```
My-Echo/
├── backend/                    FastAPI — TTS streaming, warmup, health, chats (SQLite) + pytest
├── mobile-app/
│   ├── app/                    expo-router screens (chat, phrases, stats)
│   ├── components/             ChatArea, Sidebar, Message, PhraseBar
│   ├── context/                CloudStatusContext (health check + green dot), PhrasesContext
│   └── utils/                  tts, synthQueue, typingPrefetch, split, ttsCache, chatSync, …
├── monitoring/                 Prometheus + Grafana stack
├── landing/                    Project website (GitHub Pages, /app/)
├── docs/
│   ├── adr/                    Architecture Decision Records (incl. benchmark data)
│   └── PRIVACY.md / PRIVACY_EN.md   Privacy policy
├── scripts/                    Builds the privacy policy site
└── .github/workflows/          CI/CD (see below)
```

---

## Mobile App

### Features

- **Your own voice** — messages are spoken in a cloned voice via Fish Audio cloud TTS
- **Fast start** — *Schnell* mode prepares speech while you type; *Eco* mode prepares it only on send and uses fewer requests
- **Sentence-by-sentence streaming** — playback starts with the first sentence, with no audible gap to the next one
- **On-device audio cache** — repeated phrases play instantly (LRU cache, 100 MB cap)
- **Automatic fallback** — switches to local speech synthesis when the backend is unreachable; a green dot shows the cloud status
- **Quick phrases** — a phrase bar above the input for one-tap speaking
- **Chat history** — daily auto-chat, pin, rename, delete, copy and edit messages; synced with the backend and cached offline
- **Background playback** — speech keeps playing when the screen locks
- **Usage statistics** — characters spoken, TTS response times, cache hit rate

### Run Locally

Requires Node 24 LTS (matches CI and the Docker image).

```bash
cd mobile-app
cp .env.example .env   # set EXPO_PUBLIC_BACKEND_URL to your backend IP
npm install
npm start
```

---

## Backend

A lightweight FastAPI service that proxies streaming TTS requests to Fish Audio and persists chat history in a local SQLite database. Self-hosted on a Raspberry Pi, accessible via WireGuard VPN. Distributed as a Docker image via GHCR.

### Endpoints

| Method   | Path            | Description                                            |
|----------|-----------------|--------------------------------------------------------|
| `GET`    | `/stream/tts`   | Streams MP3 audio for `?text=...` via chunked HTTP (30/min per client) |
| `GET`    | `/warmup`       | Pre-warms Fish Audio connection before user sends      |
| `GET`    | `/health`       | Returns provider status, voice/model, and API credits  |
| `GET`    | `/chats`        | Returns all stored chats                               |
| `PUT`    | `/chats/{id}`   | Creates or updates a chat (upsert)                     |
| `DELETE` | `/chats/{id}`   | Deletes a chat                                         |
| `GET`    | `/metrics`      | Prometheus metrics endpoint                            |

### Configuration

| Variable           | Default          | Purpose                       |
|--------------------|------------------|-------------------------------|
| `TTS_API_KEY`      | —                | Fish Audio API key            |
| `TTS_MODEL`        | `s2-pro`         | Model name                    |
| `TTS_VOICE`        | —                | Voice / reference ID          |
| `TTS_LATENCY`      | `balanced`       | `normal`, `balanced`, or `low`|
| `TTS_CHUNK_LENGTH` | `50`             | Tokens before first audio chunk (lower = faster TTFA) |
| `DB_PATH`          | `/data/chats.db` | SQLite chat database location |

<details>
<summary><b>Deploy (Raspberry Pi via Portainer)</b></summary>

1. Portainer → **Stacks → Add stack → Web editor**
2. Paste content of `backend/docker-compose.yml`
3. Add environment variables above
4. Deploy — container exposes port `4444` and persists chats in the `myecho-data` volume (mounted at `/data`)

Updates: push to `main` → GitHub Actions builds new image → Portainer **Pull and redeploy**. The `myecho-data` volume is kept across updates.

</details>

### CI/CD

GitHub Actions runs the backend tests (with coverage badge), typechecks and builds the Android app, creates signed releases on tags, pushes the backend Docker image to GHCR, and publishes the website to GitHub Pages.

---

## Monitoring

Prometheus + Grafana dashboard, self-hosted on the Pi. It shows request rate, latency (p50/p95/p99), error rate and warmup hit rate. The dashboard and datasource are provisioned automatically.

```bash
cp monitoring/.env.example monitoring/.env   # set BACKEND_HOST to your Pi IP
docker compose -f monitoring/docker-compose.yml up -d
```

---

## Status

myEcho is used every day by one person and is in active development. Next step: making the app usable for other people who can type but no longer speak — for example after a stroke.

---
This project is being developed with the help of Claude and other AI tools.
