# ADR 0001: Sentence pre-synthesis while typing

- **Status:** Accepted
- **Date:** 2026-10-09
- **Branch:** `feat/ttfa-measurement`

## Context

myEcho is an assistive communication app for people with voice disorders. The
user types a message and the app speaks it with a cloned voice (cloud TTS via
the backend proxy, Fish Audio). For a conversation, the important number is
**TTFA (time to first audio)**: the time from pressing *send* to the first
audible sound. Every second of silence interrupts the conversation partner.

Before this change, the app synthesized the **whole message after pressing
send**. For a typical long message (~30 words) the listener waited about
**3.5 seconds**. A cache hit (audio already on the device) starts in about
**85 ms**, so almost all of the wait is cloud synthesis.

At the same time, people who use an AAC app type slowly. While they type, the
network and the TTS service are idle. That idle time can be used.

### What real messages look like

Measured on the local chat history (2,170 user messages, only lengths were
analysed, no content):

| Metric | Value |
|---|---|
| Mean length | 92 chars (~16 words) |
| Median length | 57 chars |
| p90 length | 176 chars |
| Messages under 60 chars | 52 % |
| Sentences per message | 1.6 on average, median 1 |

Short messages are common, but long messages are where the wait hurts most.

## Decision

1. **Speak sentence by sentence.** A multi-sentence message is split into
   sentences (`utils/split.ts`). Sentence 1 plays as soon as it is ready. The
   remaining sentences are synthesized in the background while it plays. If the
   whole text is already cached (for example a saved phrase), the old
   single-file path is used.

2. **Pre-synthesize while typing ("Schnell" mode).** While the compose box is
   open, sentences are synthesized and cached in the background
   (`utils/typingPrefetchCore.ts`):
   - A sentence that is completed (`.`, `!`, `?`) **at the end of the text** is
     synthesized at once. This also covers keyboard replacements at the end
     (autocorrect, double space → period).
   - Any other change (fixing a typo in the middle, deleting, inserting) waits
     for **1 s without typing**, and then only the final version is synthesized.
     This avoids one request per keystroke.
   - The unfinished last sentence is synthesized after the same 1 s pause.

3. **One serial queue** (`utils/synthQueue.ts`): one request at a time, no
   duplicate requests for the same sentence. Queued jobs whose sentence is no
   longer in the text are dropped. A job that `speak()` is waiting for is always
   executed, even if the compose box was already closed by *send*.

4. **No silence between sentences.** While sentence N plays, the audio player
   for sentence N+1 is already created and loaded (paused). When N ends, N+1
   starts immediately.

5. **Schnell / Eco switch** in the compose header (`utils/speedMode.ts`,
   persisted, default *Schnell*). *Eco* turns off pre-synthesis while typing
   and only synthesizes on send (fewer requests, longer wait). Sentence-by-
   sentence playback stays on in both modes, because it costs no extra requests.

6. Sentence-by-sentence playback is on by default. For A/B comparisons it can
   be turned off with `EXPO_PUBLIC_SENTENCE_STREAMING=0`.

### Why pre-synthesis

- The wait after *send* is the most noticeable delay in the app. For long
  messages it was ~3.5 s, which is far too long for a natural conversation.
- The typing time of AAC users is long and otherwise unused. Synthesizing
  during that time moves the cost to a moment where nobody is waiting.
- The cache (key = exact sentence text) makes this safe: wrong or outdated
  audio can never be played. A changed sentence is simply a new key.
- The extra cost is small for one user and can be switched off (Eco).

## Measurements

Setup: Android emulator (Pixel 9 Pro XL), **debug build**, Wi-Fi, cloud TTS via
the backend. The test corpus was 10 different German messages of 28–30 words
(162–182 characters, 2–3 sentences each). TTFA was measured from `speak()` to
the first audible frame (`expo-audio` status `playing`). The values are useful
for comparison. A release build on a real phone will have different absolute
numbers.

### TTFA, 10 messages of ~30 words

| Mode | Ø | Median | p95 / max |
|---|---|---|---|
| Before: whole text after send (cold) | **3506 ms** | 3320 ms | 4172 ms |
| Sentence by sentence, synthesis after send (cold) | 2274 ms | 2243 ms | 2714 ms |
| Pre-synthesis while typing, send 1.5 s after typing | 112 ms | 109 ms | 134 ms |
| Pre-synthesis while typing, send immediately | 112 ms | 111 ms | 127 ms |
| Same, after the edit-handling fix | 101 ms | 78 ms | 299 ms |
| Best case: whole text already cached (warm) | 85 ms | 85 ms | 100 ms |

Result: the TTFA for long messages went from **~3.5 s to ~0.1 s** (about
30× faster), which is close to the cache-hit best case. Typing was simulated at
about 200 words per minute, word by word. Real AAC typing is slower, which
gives the pre-synthesis even more time.

### Other measurements

| Measurement | Result |
|---|---|
| One 30-word message, cold, 3 runs | 3966 / 3618 / 3353 ms (Ø ~3646 ms) |
| 5 mixed messages (19–151 chars), cold | Ø 2705 ms, short messages ~1.8–2.0 s |
| Cold TTFA vs. length | grows with length: ~1.9 s (19 chars) → ~3.6 s (151 chars) |
| Gap between sentences, new player per sentence | short silences, audible in a manual test |
| Gap between sentences, next player preloaded | 43 ms and 19 ms (not audible) |

### Edit handling (simulation)

The typing and queue logic was tested in isolation (real modules, fake
synthesis of 200 ms):

| Case | Requests |
|---|---|
| Type 2 sentences normally | 2 |
| 8 keystrokes inside a finished sentence | 1 (final version only; before the fix: 8) |
| Delete a finished sentence and type a new one | 1 |
| Typo and immediate undo | 0 |
| Correct a sentence while its old version is still queued | old version skipped |
| Send immediately after typing 3 sentences | all 3 synthesized (before the fix: only 1 of 3) |
| Unfinished sentence, typing continues | 0 until the 1 s pause, then 1 |

## Consequences

**Positive**
- Long messages start almost immediately when the user has typed them in
  Schnell mode.
- Even without pre-synthesis (Eco), long messages start ~35 % faster
  (3.5 s → 2.3 s), because only the first sentence must be ready.
- No audible gaps between sentences.

**Negative / risks**
- **Wasted requests:** sentences that are changed after synthesis were paid for
  and are never used. A request that is already running cannot be cancelled,
  so at most one is wasted per change. A 1 s pause in the middle of a sentence
  synthesizes a fragment that is later thrown away. The cost is small for one
  user, and Eco mode avoids it.
- **One-sentence messages sent immediately** are still cold (~2 s), because
  there was no time to pre-synthesize.
- **Intonation:** each sentence is synthesized on its own, so the melody across
  sentence boundaries can differ slightly from synthesizing the whole text.
- **Cache growth:** sentences are cached individually, so the cache holds more
  and smaller files.
- **Measurement:** the TTFA test screen used for these numbers was removed after
  the decision. TTFA and gaps are still logged as `[myEcho][TTS] [METRIC]
  path=… ttfa=…` and `[METRIC] gap=…ms` (visible with `adb logcat`).

## Alternatives considered

- **Keep synthesizing the whole text after send.** This is simple, but the
  ~3.5 s wait for long messages was the problem to solve.
- **Only split into sentences after send.** No extra requests, but it only
  improves TTFA to ~2.3 s. It is kept as the Eco behaviour.
- **Synthesize on every keystroke.** It is the fastest, but it creates one
  request per keystroke and fills the queue. It was rejected in favour of the
  sentence end plus 1 s pause rules.
- **Local TTS (expo-speech) only.** It is instant, but it does not have the
  user's own voice. It stays as the fallback when the cloud is not reachable.

## Raw data

The raw result files (JSON, one per run, with every message and its TTFA) are in
[`0001-data/`](0001-data/). The file name contains the mode (`single-stream` /
`sentence-streaming`), the run type (`cold`, `warm`, `typing-0`, `typing-1500`)
and a timestamp. Early runs of other corpora (5 mixed messages, one 30-word
message) are included for reference; their numbers are in the table above.
