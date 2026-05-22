<div align="center">

# myEcho

**A chat-style note-taking app with built-in text-to-speech.**

Capture short messages and play them back aloud — backed by a FastAPI proxy to a custom-voice TTS model.

![Expo](https://img.shields.io/badge/Expo-56-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.85-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)

</div>

---

## Table of Contents

- [About](#about)
- [Motivation](#motivation)
- [Overview](#overview)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Mobile App](#mobile-app)
- [Backend](#backend)
- [Docker Compose](#docker-compose)
- [Status](#status)

---

## About

**MyEcho is a project designed to assist individuals with voice disorders in articulating their thoughts, facilitating easier and more effective communication.**

The app gives users a calm, chat-style interface to type what they want to say and have it spoken back in a natural voice — turning written words into a reliable, repeatable spoken output for everyday conversations.

---

## Motivation


This project began with a simple goal: to build an accessible application for people who suffer from voice disorders. Speaking can be exhausting, painful, or impossible for many — and existing solutions are to complicated for people. 

**myEcho** is meant to be the opposite: a lightweight, friendly tool that helps users communicate without friction, whether at home, with family, or out in the world.

I try to give them their voice back !!!

---

## Overview

**myEcho** is a small two-part project:

| Part            | Tech                                            | Purpose                                           |
| --------------- | ----------------------------------------------- | ------------------------------------------------- |
| **Mobile app**  | Expo · React Native · TypeScript · NativeWind   | ChatGPT-style UI for capturing and replaying notes |
| **Backend**     | FastAPI · httpx · WebSockets                    | Streaming TTS proxy in front of a vLLM server     |

---

## Project Structure

```text
My-Echo/
├── backend/              FastAPI WebSocket TTS proxy
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── mobile-app/           Expo / React Native client
│   ├── app/              expo-router screens
│   ├── components/       Sidebar, ChatArea, Message
│   ├── utils/            storage helper
│   └── package.json
└── docker-compose.yml
```

---

## Quick Start

Spin up both services with Docker Compose:

```bash
docker compose up --build
```

Or run them individually — see [Mobile App](#mobile-app) and [Backend](#backend) below.

---

## Mobile App

An Expo app written in TypeScript, using `expo-router`, NativeWind/Tailwind, and `lucide-react-native` icons.

### Features

- **Chat history sidebar** — create, pin, rename, and delete chats.
- **Daily auto-chat** — a new "Neuer Chat" is created automatically on a new day.
- **Two send actions** — *Send* saves and auto-plays the message; *Save* stores it silently.
- **Per-message playback** — every bubble has a play/pause button powered by `expo-speech` (German `de-DE`).
- **Inline editing** — user messages can be edited in place.
- **Local persistence** — chats are stored in `expo-secure-store` under the key `myEchoChats`.

### Key Files

| File                          | Responsibility                                          |
| ----------------------------- | ------------------------------------------------------- |
| `app/index.tsx`               | Main screen, chat state, persistence                    |
| `components/ChatArea.tsx`     | Message list and fullscreen compose modal               |
| `components/Message.tsx`      | Message bubble, TTS playback, inline editing            |
| `components/Sidebar.tsx`      | Chat list and management                                |
| `utils/storage.ts`            | `expo-secure-store` wrapper                             |

> **Note:** The UI is currently in German.

### Run Locally

```bash
cd mobile-app
npm install

npm start          # Expo dev server
npm run android    # build & run on Android
npm run ios        # build & run on iOS
npm run web        # open in browser
```

---

## Backend

A small FastAPI service that proxies a streaming TTS endpoint to a [vLLM](https://github.com/vllm-project/vllm) server running the `qwen3-tts` model with a `custom` voice.

### Endpoint

| Method      | Path        | Payload                  | Response                          |
| ----------- | ----------- | ------------------------ | --------------------------------- |
| `WebSocket` | `/ws/tts`   | `{ "text": "..." }` JSON | Streamed audio bytes from vLLM    |

### Configuration

| Variable    | Default                  | Purpose                            |
| ----------- | ------------------------ | ---------------------------------- |
| `VLLM_URL`  | `http://localhost:8000`  | Base URL of the upstream vLLM server |

### Run Locally

```bash
cd backend
pip install -r requirements.txt

VLLM_URL=http://localhost:8000 \
  uvicorn main:app --host 0.0.0.0 --port 8080
```

---

## Docker Compose

```bash
docker compose up --build
```

**Exposed ports**

| Service     | Host port      | Container port | Notes                  |
| ----------- | -------------- | -------------- | ---------------------- |
| Mobile app  | `8082`         | `8081`         | Metro bundler          |
| Mobile app  | `19000–19002`  | `19000–19002`  | Expo dev tooling       |
| Backend     | `8081`         | `8080`         | FastAPI                |

---

## Status

The mobile app currently uses the device's **built-in TTS** via `expo-speech`.
The backend `/ws/tts` proxy is in place but **not yet wired up** to the client — connecting the app to the custom voice model is the next step.