<div align="center">

🌐 [English](README.md) | **Deutsch**

# myEcho

## *„Denen eine Stimme geben, die ihre verloren haben."*

<br/>

**Assistive Kommunikations-App für Menschen mit Stimmstörungen.**

Tippe, was du sagen möchtest — myEcho spricht es mit deiner eigenen Stimme aus.

[**Website**](https://seiferla.github.io/My-Echo/app/) · [**Evaluation Voice Cloning**](https://github.com/seiferla/als-voice-cloning-evaluation)

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

## Inhaltsverzeichnis

- [Über das Projekt](#über-das-projekt)
- [Demo](#demo)
- [So funktioniert es](#so-funktioniert-es)
- [Performance](#performance)
- [Projektstruktur](#projektstruktur)
- [Mobile App](#mobile-app)
- [Backend](#backend)
- [Monitoring](#monitoring)
- [Status](#status)

---

## Über das Projekt

**myEcho wurde für Menschen entwickelt, die ihre eigene Stimme nicht mehr nutzen können.**

Das Projekt begann, als meine Mutter an ALS in der bulbären Form erkrankte. Dabei werden zuerst die Muskeln zum Sprechen schwächer, deshalb kann sie heute kaum noch deutlich sprechen. Die meisten Voice-Cloning-Lösungen brauchen mehrere Minuten Studioaufnahmen — dafür war ihre Stimme schon zu instabil. Weil das TTS-Modell zero-shot arbeitet, haben **30 Sekunden aus alten WhatsApp-Sprachnachrichten**, aufgenommen lange vor ihrer Erkrankung, gereicht, um ihre Stimme nachzubilden.

Sie nutzt myEcho seit mehreren Monaten im Alltag: Sie tippt, was sie sagen möchte, und die App spricht es mit ihrer alten Stimme aus. Die Oberfläche ist bewusst ruhig und einfach — keine Hürden, keine Komplexität.

Die Modelle dahinter wurden in einer eigenen Projektarbeit an der Hochschule verglichen: [als-voice-cloning-evaluation](https://github.com/seiferla/als-voice-cloning-evaluation).

---

## Demo

<div align="center">

<img src="docs/demo.gif" alt="myEcho in Aktion — eine Nachricht tippen und laut vorlesen lassen" width="260" />

</div>

---

## So funktioniert es

<div align="center">

![myEcho Architekturdiagramm](docs/myecho-architecture.svg)

</div>

> Diagramm-Quelle: [`docs/architecture.puml`](docs/architecture.puml) (PlantUML). Neu erzeugen mit `java -jar plantuml.jar -tsvg docs/architecture.puml`.

1. Der Nutzer öffnet das Eingabefeld → das Backend wärmt die Fish-Audio-Verbindung vor
2. Im Modus **Schnell** (Standard) werden fertige Sätze schon während des Tippens synthetisiert; im Modus **Eco** erst beim Senden
3. Der Nutzer drückt auf Senden → der erste Satz startet sofort; die restlichen Sätze werden während der Wiedergabe vorbereitet
4. Die App prüft den Audio-Cache auf dem Gerät → bei einem Treffer wird sofort aus der lokalen Datei abgespielt
5. Cache-Miss: Die App fordert das Audio per HTTP-Streaming vom selbst gehosteten Backend an
6. Das Backend leitet den Text an Fish Audio weiter und streamt MP3-Chunks in Echtzeit zurück
7. Die MP3 wird im Geräte-Cache gespeichert, sodass dieselbe Phrase beim nächsten Mal sofort abgespielt wird
8. Ist das Backend nicht erreichbar, wechselt die App automatisch auf lokale Sprachsynthese

Chats werden unabhängig vom Audio synchronisiert: Beim Start **führt** die App Backend- und lokale Chats **zusammen**, der Verlauf wird also nie überschrieben und übersteht eine Neuinstallation. Offline-Änderungen werden beim nächsten erreichbaren Start synchronisiert.

---

## Performance

Im Gespräch zählt vor allem die **Time to First Audio (TTFA)**: die Zeit vom Drücken auf *Senden* bis zum ersten Ton. Jede Sekunde Stille unterbricht das Gegenüber.

Menschen, die eine AAC-App nutzen, tippen langsam — in dieser Zeit ist das Netzwerk ungenutzt. myEcho nutzt diese Zeit und **synthetisiert fertige Sätze schon während des Tippens**. Lange Nachrichten werden dann **Satz für Satz** abgespielt.

**TTFA für 10 Nachrichten mit ~30 Wörtern** (Android-Emulator, Debug-Build, Cloud-TTS):

| Modus | Ø TTFA |
|---|---|
| Vorher: ganzer Text nach dem Senden synthetisiert | **3506 ms** |
| Satzweise, Synthese nach dem Senden (*Eco*) | 2274 ms |
| Vorab-Synthese beim Tippen (*Schnell*) | **~100 ms** |
| Bestfall: ganzer Text schon im Cache | 85 ms |

- Lange Nachrichten starten etwa **30× schneller** (~3,5 s → ~0,1 s), fast so schnell wie ein Cache-Treffer.
- Auch im *Eco*-Modus starten lange Nachrichten ~35 % schneller, ohne zusätzliche Anfragen.
- Der nächste Satz wird schon während der Wiedergabe geladen, die Pause zwischen Sätzen liegt nur bei 19–43 ms (nicht hörbar).

Details, Umgang mit Korrekturen und Rohdaten: [ADR 0001 — Sentence pre-synthesis while typing](docs/adr/0001-sentence-presynthesis.md).

---

## Projektstruktur

```
My-Echo/
├── backend/                    FastAPI — TTS-Streaming, Warmup, Health, Chats (SQLite) + pytest
├── mobile-app/
│   ├── app/                    expo-router Screens (Chat, Phrasen, Statistik)
│   ├── components/             ChatArea, Sidebar, Message, PhraseBar
│   ├── context/                CloudStatusContext (Health-Check + grüner Punkt), PhrasesContext
│   └── utils/                  tts, synthQueue, typingPrefetch, split, ttsCache, chatSync, …
├── monitoring/                 Prometheus + Grafana Stack
├── landing/                    Projekt-Website (GitHub Pages, /app/)
├── docs/
│   ├── adr/                    Architecture Decision Records (inkl. Benchmark-Daten)
│   └── PRIVACY.md / PRIVACY_EN.md   Datenschutzerklärung
├── scripts/                    Baut die Datenschutz-Seite
└── .github/workflows/          CI/CD (siehe unten)
```

---

## Mobile App

### Funktionen

- **Die eigene Stimme** — Nachrichten werden mit einer geklonten Stimme über Fish-Audio-Cloud-TTS gesprochen
- **Schneller Start** — der Modus *Schnell* bereitet die Sprache schon beim Tippen vor; *Eco* erst beim Senden und mit weniger Anfragen
- **Satzweises Streaming** — die Wiedergabe startet mit dem ersten Satz, ohne hörbare Pause zum nächsten
- **Audio-Cache auf dem Gerät** — wiederholte Phrasen werden sofort abgespielt (LRU-Cache, 100 MB Limit)
- **Automatischer Fallback** — wechselt auf lokale Sprachsynthese, wenn das Backend nicht erreichbar ist; ein grüner Punkt zeigt den Cloud-Status
- **Schnellphrasen** — eine Phrasenleiste über dem Eingabefeld zum Sprechen per Tipp
- **Chatverlauf** — täglicher Auto-Chat, anheften, umbenennen, löschen, Nachrichten kopieren und bearbeiten; mit dem Backend synchronisiert und offline zwischengespeichert
- **Wiedergabe im Hintergrund** — die Sprache läuft weiter, wenn der Bildschirm gesperrt wird
- **Nutzungsstatistik** — gesprochene Zeichen, TTS-Antwortzeiten, Cache-Trefferquote

### Lokal starten

Benötigt Node 24 LTS (passend zu CI und Docker-Image).

```bash
cd mobile-app
cp .env.example .env   # EXPO_PUBLIC_BACKEND_URL auf die eigene Backend-IP setzen
npm install
npm start
```

---

## Backend

Ein schlanker FastAPI-Dienst, der Streaming-TTS-Anfragen an Fish Audio weiterleitet und den Chatverlauf in einer lokalen SQLite-Datenbank speichert. Selbst gehostet auf einem Raspberry Pi, erreichbar über WireGuard-VPN. Wird als Docker-Image über GHCR verteilt.

### Endpunkte

| Methode  | Pfad            | Beschreibung                                                   |
|----------|-----------------|----------------------------------------------------------------|
| `GET`    | `/stream/tts`   | Streamt MP3-Audio für `?text=...` per Chunked HTTP (30/min pro Client) |
| `GET`    | `/warmup`       | Wärmt die Fish-Audio-Verbindung vor, bevor der Nutzer sendet   |
| `GET`    | `/health`       | Liefert Provider-Status, Stimme/Modell und API-Guthaben        |
| `GET`    | `/chats`        | Liefert alle gespeicherten Chats                               |
| `PUT`    | `/chats/{id}`   | Erstellt oder aktualisiert einen Chat (Upsert)                 |
| `DELETE` | `/chats/{id}`   | Löscht einen Chat                                              |
| `GET`    | `/metrics`      | Prometheus-Metrik-Endpunkt                                     |

### Konfiguration

| Variable           | Standard         | Zweck                                                         |
|--------------------|------------------|---------------------------------------------------------------|
| `TTS_API_KEY`      | —                | Fish-Audio-API-Key                                            |
| `TTS_MODEL`        | `s2-pro`         | Modellname                                                    |
| `TTS_VOICE`        | —                | Stimme / Referenz-ID                                          |
| `TTS_LATENCY`      | `balanced`       | `normal`, `balanced` oder `low`                               |
| `TTS_CHUNK_LENGTH` | `50`             | Tokens bis zum ersten Audio-Chunk (niedriger = schnelleres TTFA) |
| `DB_PATH`          | `/data/chats.db` | Speicherort der SQLite-Chat-Datenbank                         |

<details>
<summary><b>Deployment (Raspberry Pi über Portainer)</b></summary>

1. Portainer → **Stacks → Add stack → Web editor**
2. Inhalt von `backend/docker-compose.yml` einfügen
3. Die oben genannten Umgebungsvariablen hinzufügen
4. Deployen — der Container öffnet Port `4444` und speichert Chats im Volume `myecho-data` (eingehängt unter `/data`)

Updates: Push auf `main` → GitHub Actions baut ein neues Image → in Portainer **Pull and redeploy**. Das Volume `myecho-data` bleibt bei Updates erhalten.

</details>

### CI/CD

GitHub Actions führt die Backend-Tests aus (mit Coverage-Badge), prüft und baut die Android-App, erstellt signierte Releases bei Tags, pusht das Backend-Docker-Image nach GHCR und veröffentlicht die Website auf GitHub Pages.

---

## Monitoring

Prometheus + Grafana Dashboard, selbst gehostet auf dem Pi. Zeigt Request-Rate, Latenz (p50/p95/p99), Fehlerrate und Warmup-Trefferquote. Dashboard und Datasource werden automatisch eingerichtet.

```bash
cp monitoring/.env.example monitoring/.env   # BACKEND_HOST auf die Pi-IP setzen
docker compose -f monitoring/docker-compose.yml up -d
```

---

## Status

myEcho wird von einer Person täglich genutzt und aktiv weiterentwickelt. Nächster Schritt: die App auch für andere Betroffene nutzbar machen, die noch tippen, aber nicht mehr sprechen können — zum Beispiel nach einem Schlaganfall.

---
Dieses Projekt wird mit Hilfe von Claude und anderen KI-Tools entwickelt.
