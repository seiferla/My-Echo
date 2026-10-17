# References — how myEcho compares

Short fact sheet behind the comparison on the landing page (`landing/`).
Only public information. **Last checked: 2026-10-17.** Prices and features change — check the provider before you rely on them.

## Recording time to create a personal voice

| Provider | What it asks for | Language note | Source type |
|---|---|---|---|
| Apple *Personal Voice* (iOS 26 and later) | 10 randomised phrases, voice ready "in under a minute"; short three-word phrases are possible if speaking is hard | Personal Voice is only available in English (US), Mandarin (mainland China) and Spanish (Mexico). *Live Speech* works in German, but only with system voices | Primary (Apple) |
| Apple *Personal Voice* (iOS 17 / 18) | About 150 phrases, "15 minutes of audio" (Apple 2023) | same | Primary (Apple), **outdated since iOS 26** |
| Acapela *My-Own-Voice* | 50 sentences; Acapela names 10–20 min, 20–30 min and "in just 10 minutes" on different pages | German supported | Primary (Acapela) |
| ElevenLabs *Professional Voice Cloning* | "Bare minimum 30 minutes", best 2–3 hours | German supported; free 5-year licence for people with permanent voice loss through the Impact Program | Primary (ElevenLabs) |
| ElevenLabs *Instant Voice Cloning* | About 1–3 minutes | German supported | Primary (ElevenLabs) |
| Fish Audio *voice cloning* (used by myEcho) | At least 10 s per clip; "a minute or two of clear, single-speaker speech improves fidelity" | — | Primary (Fish Audio) |
| **myEcho** | The personal voice in the app was created from about **30 seconds** of recording | The app speaks German | Own information |

Classic voice banking asks for much more: ModelTalker recommends about 1,600 sentences, SpeakUnique about 125 sentences (other sources say 150–400).

## Other facts used on the page

- **Proloquo2Go price:** €299.99 in the German App Store on 2026-10-17. The US store showed $124.99 during a 50 % promotion (14–21 Oct 2026), regular price $249.99. The EASTIN / REHADAT entry (299.99 EUR, price date 2025-02-11) still matches, but its other product data is outdated.
- **Apple Live Speech:** type-to-speak with system voices or a Personal Voice; works in calls and FaceTime; not available in all languages.

## What is different about myEcho

These points come from this repository, not from outside sources.

- **A personal voice from about 30 seconds of audio**, and the app speaks German.
- **Natural voice without the wait.** Speech is made sentence by sentence. The first sentence plays while the next ones are prepared (`README.md` → *How It Works*).
- **Schnell / Eco mode.** *Schnell* prepares speech while you type, so playback starts at once on send. *Eco* prepares it only on send.
- **Always able to speak.** If the cloud voice is not reachable, the app switches to the voice on the device.
- **Instant repeats.** Repeated phrases play from a local audio cache.
- **No account, no ads, no tracking** (`docs/PRIVACY_EN.md`).

## Honest limits

- myEcho is **not** a full AAC system. It has no symbol vocabulary and is made for people who can still type.
- It needs an internet connection for the natural voice. Offline it uses the device voice.
- It is currently shared with a small test group, not published in a public store.
- The voice is set once on the server (`TTS_VOICE`). Recording and cloning your own voice inside the app is not built yet.
- Short zero-shot clones are fast, but more clean audio usually gives a more robust voice. If you can, record much more than the minimum (30–60 minutes of clean speech) as a backup while your voice is still good.
- Cloud-bound clones can disappear: PlayHT shut down on 2025-12-31 and deleted voice clones without an export. Keep the original recordings.
- No latency measurements against other apps were made. "Starts speaking sooner" is a design goal, not a benchmark result.
- The Fish Audio *"Creating models: best practices"* page has been merged into the voice-cloning page; the older "two samples of 30–45 s" advice is no longer published.

## Sources

- Apple — [Accessibility features](https://www.apple.com/accessibility/features/) (Personal Voice: 10 phrases, under a minute)
- Apple Newsroom — [New accessibility features, 13 May 2025](https://www.apple.com/newsroom/2025/05/apple-unveils-powerful-accessibility-features-coming-later-this-year/)
- Apple — [iOS and iPadOS 26 feature availability](https://www.apple.com/lae/ios/feature-availability/) and [iOS 27](https://www.apple.com/ios/feature-availability/) (Personal Voice languages)
- Apple Support — [Create a Personal Voice](https://support.apple.com/HT213878)
- Apple Support — [Type to speak using Live Speech on iPhone](https://support.apple.com/en-ae/guide/iphone/iphcf92d2d9b)
- Apple — [Accessibility: Speech (regional page, outdated: "15 minutes")](https://www.apple.com/lae/accessibility/speech/)
- Acapela — [Voice banking in 50 sentences (My-Own-Voice v3)](https://www.acapela-group.com/news/voice-banking-in-50-sentences-introducing-version-3-of-My-Own-Voice/) and [My-Own-Voice FAQ](https://mov.acapela-group.com/faq/faq-device/)
- ElevenLabs — [Professional Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning) and [Voice Cloning overview](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning)
- Fish Audio — [Voice cloning](https://docs.fish.audio/features/voice-cloning)
- Proloquo2Go — [German App Store](https://apps.apple.com/de/app/proloquo2go-aac/id308368164) and [AssistiveWare product page](https://www.assistiveware.com/products/proloquo2go)
- EASTIN / REHADAT — [Proloquo2Go entry](https://www.eastin.eu/en/searches/products/detail/database-rehadat/id-tec_129177.0) (price only; product data outdated)
- ModelTalker — [modeltalker.org](https://modeltalker.org/); SpeakUnique — [Voice Build](https://www.speakunique.co.uk/our-voice-bank-services/voice-build/)
- Jain et al. (Apple) — [Compact Neural TTS Voices for Accessibility](https://arxiv.org/html/2501.17332v1) (arXiv preprint; the abstract describes the usual trade-off between fast on-device voices and natural cloud voices, but the paper's own result is a compact on-device neural voice with about 13 ms latency)

### Sources that were replaced

- Fox News (2024) — said "150 phrases"; no "15 minutes" statement; outdated since iOS 26.
- AssistiveWare press release (2013) — historic (Proloquo2Go 3.0); not valid for today's voices or prices.
