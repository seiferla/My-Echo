# References — how myEcho compares

Short fact sheet behind the comparison on the landing page (`landing/`).
Only public information. **Last checked: 2026-10-17.** Prices and features change — check the vendor before you rely on them.

## The approaches

| | Built-in type-to-speak | Full AAC app | myEcho |
|---|---|---|---|
| Example | Apple *Live Speech* (iOS 17+) | AssistiveWare *Proloquo2Go* | this project |
| Made for | Anyone who needs to speak by typing | Complex communication needs, symbol-based | People with voice disorders who can type |
| Voice | System voices, or *Personal Voice* (needs about 15 min of your own recording; iPhone 12 or newer; not possible if you cannot speak) | Natural-sounding voices, several accents | Natural cloud AI voice (Fish Audio), cloned from about 30 s of audio; local voice as fallback |
| Price | Free, built into the phone | One-time purchase, about 250–300 EUR (retail, early 2025) | Free, open source, private project |

## What is different about myEcho

These points come from this repository, not from outside sources.

- **A voice cloned from about 30 seconds of audio.** Fish Audio asks for at least 10 s per sample and recommends longer clean samples for best quality (see sources). Apple's Personal Voice asks for about 15 minutes.
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
- No latency measurements against other apps were made. "Starts speaking sooner" is a design goal, not a benchmark result.

## Sources

- Apple — [Type to speak using Live Speech on iPhone](https://support.apple.com/en-ae/guide/iphone/iphcf92d2d9b)
- Apple — [Accessibility: Speech](https://www.apple.com/lae/accessibility/speech)
- Fox News — [Benefits of Apple's Personal Voice and Live Speech](https://foxnews.com/tech/life-changing-benefits-apples-personal-voice-live-speech.amp) (secondary: setup needs about 15 minutes of recording)
- EASTIN / REHADAT — [Proloquo2Go product entry](https://www.eastin.eu/en/searches/products/detail/database-rehadat/id-tec_129177.0) (299.99 EUR incl. VAT, price date 2025-02-11, non-binding)
- AssistiveWare — [Proloquo2Go press release (voices)](https://assistiveware.com/press-releases/assistiveware-reveals-proloquo2go-30-expressivepower-switch-access-social-sharing-new-voices-and) (old announcement)
- Apple Machine Learning Research — [Compact Neural TTS Voices for Accessibility](https://arxiv.org/html/2501.17332v1) (device voices are fast but less natural; cloud neural voices are more natural but add latency)
- Fish Audio — [Creating models: best practices](https://docs.fish.audio/resources/best-practices/creating-models) (at least 10 s per sample in the guide; two samples of 30–45 s recommended)
- Fish Audio — [Voice cloning](https://docs.fish.audio/features/voice-cloning) (a clean 10 s reference can be enough; longer helps)
