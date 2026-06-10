<div align="center">

# myEcho

## *"Giving a voice back to those who lost theirs."*

<br/>

**Assistive communication app for people with voice disorders.**

Type what you want to say — myEcho speaks it back in a natural AI voice.

<br/>

![Expo](https://img.shields.io/badge/Expo-56-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.85-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)

</div>

---

## About

**myEcho is built for people who can no longer use their own voice.**

Speaking can be exhausting, painful, or impossible — and existing solutions are often too complicated. myEcho is the opposite: a calm, simple interface where you type what you want to say and the app speaks it back in a natural voice. No friction. No complexity.

---

## How It Works

```
Mobile App  ──HTTP Stream──►  Backend (Pi)  ──WebSocket──►  Fish Audio API
            ◄───────────────               ◄────────────── (AI voice chunks)
              MP3 streamed back
        ▲
        └── on-device audio cache (LRU, 100 MB cap)
```

1. User opens the compose field → backend pre-warms the Fish Audio connection
2. User types and taps Send
3. App checks the on-device audio cache → cache hit plays instantly from local file
4. Cache miss: app requests audio via HTTP streaming from the self-hosted backend
5. Backend forwards text to Fish Audio and streams MP3 chunks back in real time
6. The MP3 is stored in the device cache so the next playback of the same phrase is instant
7. If the backend is unreachable, the app falls back to local speech synthesis automatically

---

## Project Structure

```
My-Echo/
├── backend/
│   ├── main.py                 FastAPI — HTTP streaming + WebSocket proxy + warmup + health
│   ├── requirements.txt
│   └── Dockerfile
├── mobile-app/
│   ├── app/                    expo-router screens
│   ├── components/             Sidebar, ChatArea, Message
│   ├── context/                CloudStatusContext (health check + green dot)
│   └── utils/                  storage, tts, ttsCache, config, stats
├── monitoring/
│   ├── docker-compose.yml      Prometheus + Grafana stack
│   ├── prometheus/             Scrape config
│   └── grafana/                Dashboard + datasource provisioning
└── .github/workflows/
    ├── android-release.yml     Signed APK/AAB build + GitHub Release
    └── backend-deploy.yml      Docker image build + push to GHCR
```

---

## Mobile App

### Features

- **Cloud TTS** — messages are spoken in a natural AI voice via Fish Audio
- **HTTP streaming** — playback starts immediately, no waiting for full audio
- **On-device audio cache** — repeated phrases play instantly from a local LRU cache (100 MB cap, evicts down to 80 MB); hit rate and size are visible on the stats screen
- **Pre-warming** — backend prepares the Fish Audio connection while the user is typing
- **Automatic fallback** — switches to local speech synthesis when the backend is unavailable
- **Status indicator** — green dot in the header shows whether the cloud connection is active
- **Chat history sidebar** — create, pin, rename, and delete chats
- **Daily auto-chat** — a new chat is created automatically each day
- **Two send actions** — *Send* saves and auto-plays the message; *Save* stores it silently
- **Per-message playback** — every bubble has a play/pause button
- **Inline editing** — user messages can be edited in place
- **Usage statistics** — tracks characters spoken and TTS response times
- **Local persistence** — chats stored in `expo-secure-store`

### Run Locally

```bash
cd mobile-app
npm install
npm start
```

---

## Backend

A lightweight FastAPI service that proxies streaming TTS requests to Fish Audio. Self-hosted on a Raspberry Pi, accessible via WireGuard VPN. Distributed as a Docker image via GHCR.

### Endpoints

| Method  | Path          | Description                                           |
|---------|---------------|-------------------------------------------------------|
| `GET`   | `/stream/tts` | Streams MP3 audio for `?text=...` via chunked HTTP    |
| `GET`   | `/warmup`     | Pre-warms Fish Audio connection before user sends     |
| `GET`   | `/health`     | Returns provider status and API credit info           |
| `GET`   | `/metrics`    | Prometheus metrics endpoint                           |
| `WS`    | `/ws/tts`     | Legacy WebSocket TTS proxy                            |

### Configuration

| Variable      | Default      | Purpose              |
|---------------|--------------|----------------------|
| `TTS_API_KEY` | —            | Fish Audio API key   |
| `TTS_MODEL`   | `s2-pro`     | Model name           |
| `TTS_VOICE`   | —            | Voice / reference ID |

### Deploy (Raspberry Pi via Portainer)

1. Portainer → **Stacks → Add stack → Web editor**
2. Paste content of `backend/docker-compose.yml`
3. Add environment variables above
4. Deploy — container exposes port `4444`

Updates: push to `main` → GitHub Actions builds new image → Portainer **Pull and redeploy**

---

## Monitoring

Prometheus + Grafana dashboard self-hosted on the Pi.

```
http://192.168.178.21:3001
```

Shows request rate, latency (p50/p95/p99), error rate and warmup hit rate.
Setup instructions: [`monitoring/SETUP.md`](monitoring/SETUP.md)

---

## CI/CD

| Workflow | Trigger | Result |
|---|---|---|
| `android-release.yml` | Push tag `v*.*.*` | Signed APK attached to GitHub Release |
| `backend-deploy.yml` | Push to `backend/` on `main` | Docker image pushed to GHCR |

```bash
# Mobile release
git tag v1.2.0 && git push origin v1.2.0

# Backend deploys automatically on every push to backend/
```

---

## Status

The app is in active development, built for personal use.
