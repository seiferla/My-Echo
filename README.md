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
Mobile App  ──WebSocket──►  Backend (Pi)  ──WebSocket──►  Fish Audio API
            ◄──────────────               ◄────────────── (AI voice chunks)
              Audio streamed back
```

1. User types a message and taps Send
2. App opens a WebSocket to the self-hosted backend
3. Backend streams the text to Fish Audio's TTS API
4. Audio chunks return in real time and play on the device
5. If the backend is unreachable, the app falls back to local speech synthesis automatically

---

## Project Structure

```
My-Echo/
├── backend/
│   ├── main.py                 FastAPI WebSocket proxy + health endpoint
│   ├── providers/
│   │   ├── base.py             Abstract TTS provider interface
│   │   └── fish_audio.py       Fish Audio implementation
│   ├── requirements.txt
│   └── Dockerfile
├── mobile-app/
│   ├── app/                    expo-router screens
│   ├── components/             Sidebar, ChatArea, Message
│   ├── context/                CloudStatusContext (health check)
│   └── utils/                  storage, tts, config, stats
└── .github/workflows/
    └── android-release.yml     Signed APK/AAB build + GitHub Release
```

---

## Mobile App

### Features

- **Cloud TTS** — messages are spoken in a natural AI voice via Fish Audio
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

A lightweight FastAPI service that proxies streaming TTS requests to Fish Audio. Self-hosted on a Raspberry Pi, accessible via WireGuard VPN.

### Endpoints

| Method      | Path       | Description                                      |
|-------------|------------|--------------------------------------------------|
| `WebSocket` | `/ws/tts`  | Receives `{"text": "..."}`, streams MP3 chunks back |
| `GET`       | `/health`  | Returns provider status and API credit info      |

### Configuration

| Variable                 | Default      | Purpose                        |
|--------------------------|--------------|--------------------------------|
| `TTS_PROVIDER`           | `fish_audio` | Active TTS provider            |
| `TTS_API_KEY`            | —            | Provider API key               |
| `TTS_MODEL`              | `s2-pro`     | Model name                     |
| `TTS_VOICE`              | —            | Voice / reference ID           |
| `TTS_SPEED`              | `0.85`       | Playback speed                 |
| `TTS_VOLUME`             | `2`          | Volume boost                   |

### Adding a New Provider

1. Create `backend/providers/<name>.py`, extend `TTSProvider`, implement `synthesize()`
2. Register it in `backend/providers/__init__.py`
3. Set `TTS_PROVIDER=<name>` in your environment

### Deploy (Raspberry Pi via Portainer)

1. In Portainer → **Stacks → Add stack → Repository**
2. Point to this repo, set Compose path to `backend/docker-compose.yml`
3. Add the environment variables above
4. Deploy — the container exposes port `4444`

---

## CI/CD

GitHub Actions builds a signed Android APK or AAB on every version tag:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The workflow runs a TypeScript check, builds the app with Gradle, and attaches the APK to a GitHub Release automatically.

---

## Status

The app is in active development, built for personal use.
