# ADR 0003: Mistral Voxtral TTS instead of Fish Audio

Status: accepted by the author (decided 2026-10-27, written down 2026-11-04). To confirm with the supervisor (issue #220). Related: goals G3, G6, G7, G8; issues #219, #29; PR #246.

## Context

myEcho needs speech synthesis and a cloned voice per user (G3, a must). The data is sensitive: voice samples and message text of people with voice disorders (GDPR). Until now the backend used Fish Audio (`s2-pro`, WebSocket). The facts below were checked on the official pages on 2026-11-04. "Not found" means the page does not say it.

## Options

| Option | Facts | Reason against |
|---|---|---|
| **Fish Audio** | $15 per 1M UTF-8 bytes (`s2-pro`, `s2.1-pro`). Concurrency limit by prepaid amount: under $100 = 5, from $100 = 15, from $1,000 = 50. Cloning via `POST /model`, delete via `DELETE /model/{id}`. | Company is Hanabi AI Inc., Delaware (USA). No DPA found. Storage location and retention of voice samples not stated. The terms allow using content to train or improve AI models, without an exception for voice samples. They grant a perpetual, irrevocable licence on uploads and say deletion may be incomplete. No clause about consent of the person whose voice is cloned. Privacy policy dated 2024-08-28. |
| **Mistral Voxtral TTS 3** | $13 per 1M characters (model page). Default hosting in the EU, French company (Mistral AI SAS). DPA offered (effective 2026-07-27). Saved voices via `/v1/audio/voices`, with delete and a `retention_notice` (default 30 days, 1–365). Zero Data Retention possible for `/v1/audio/speech` (needs approval). | Public preview. See "Risks" below. |
| ElevenLabs | Per-voice usage in the API, delete endpoint. About $0.08 per 1k characters. EU data residency only in Enterprise. | About 5 times the price. Research of 2026-10-26, not checked again. |

Not criteria: audio quality and latency. Fish Audio latency was measured (`docs/adr/0001-data`), Mistral latency was not (see "Open points").

## Decision

1. Use **Mistral Voxtral TTS 3** (`voxtral-mini-tts-3-0`) for speech and for cloned voices. The backend calls the HTTP/SSE endpoint `/v1/audio/speech`. The WebSocket code and the warm-up are removed.
2. One cloned voice per user. The backend stores only the `voice_id` and the consent time (`user_voices`). The audio sample is not stored by us.
3. Mistral has one workspace and does not separate voices per end user. **We** map `voice_id` to `user_id` and test that user B never gets the voice of user A.
4. Mistral shows usage per model, not per voice or user. **We** need our own metering (G7).
5. `TTS_PROVIDER` is `mistral` (default) or `mock` (load tests). Any other value stops the start.

## Why

- **Data protection:** a European company with EU default hosting, a DPA, and the option of Zero Data Retention for speech generation. For Fish Audio I found none of these (no DPA, no location, training allowed in the terms).
- **Voice management:** Mistral lets us set a retention time and delete a voice by API. This supports account deletion (G8).
- **Price:** about the same. Fish bills UTF-8 bytes, Mistral bills characters. For German text with umlauts, Fish costs roughly $15–16 per 1M characters (estimate).
- **Simpler code:** HTTP instead of WebSocket, 166 lines less in the switch commit (`ee87fe2b`).
- **Limits for many users** (see "Limits compared"). The Fish Audio starter tier (5 concurrent requests) is too low for the 20-user load test, and its terms may not allow one account for many end users. For Mistral the numbers are not public, so this is a real advantage only after we have read them.

## Limits compared

| | Fish Audio | Mistral |
|---|---|---|
| Concurrent requests | 5 (under $100 prepaid), 15 (from $100), 50 (from $1,000). Per account, shared by all keys. At the limit: HTTP 429 without `Retry-After`, no queue found. The tier unlocks by prepaid amount. | "Requests per second" means the maximum of concurrent requests, per workspace, shared by all keys. The numbers are only in the Admin Panel (API, Limits), not read. A higher limit is requested through support. |
| Does an open stream count? | Not documented for the WebSocket. | Not documented, probably until the stream ends. |
| Stored cloned voices | No count limit found for the API. Web plans: Free 3 public voice slots, Plus 10 private, Pro unlimited. Not documented whether the API counts against these slots. A clone per request without storing is possible (`references`). | No count limit found, and none is excluded. Saved voices stay up to `retention_notice` (default 30 days). |
| One account for many end users | Terms: free use is "own use, not for the benefit of a third party". Sharing the account or credentials with people outside the organization is not allowed. No reseller clause found (enterprise page was not readable). | Nothing found. The docs advise one workspace per project. |

Estimate for the load test (20 users, one message every 15 s on average, a request is open for S seconds, Poisson model): mean open requests = 20 / 15 × S.

| S (seconds) | Mean open | More than 5 at once | More than 15 at once |
|---|---|---|---|
| 3 | 4.0 | 22 % of the time | below 0.01 % |
| 5 | 6.7 | 65 % | 0.15 % |
| 8 | 10.7 | 95 % | 7.6 % |

So with the starter tier, many requests would get a 429 at 10–20 users. The 15-slot tier is enough for S up to about 5 s. It needs $100 prepaid, which is the whole budget in `goals.md`. The real duration of a request was not measured, and real users type slowly, so normal use is far below this worst case. The G6 criterion (20 users) is not.

## Risks and consequences

- **Preview model.** Voxtral 3 is labelled "Public Preview". Behavior, price and limits can change. The pricing page speaks of "per minute" for speech models and the model page of "per character". Check the invoice.
- **Training default not clear.** The DPA says Mistral may train unless the customer opted out. The default for pay-as-you-go is not stated. We must opt out in the console and write it down.
- **Zero Data Retention** covers `/v1/audio/speech`, not `/v1/audio/voices`. Saved voices are stored objects, so they probably stay until deleted or until `retention_notice` ends.
- **Location of voice samples and sub-processors:** not found (the Trust Center could not be read). Some features may transfer data outside the EU.
- **Consent:** the Mistral docs have no readable consent rule for voice cloning. The DPA puts the duty on us (we must get the consents). We store `consented_at` before the upload.
- **Rate limits and the limit of saved voices** are not public. Read them in the admin panel before G6 and write them down here.
- **One workspace for all users.** Limits are per workspace, so all users share them. Nothing was found about multi-tenant use.

## Reversal triggers

- Mistral cannot confirm what happens when `retention_notice` ends, or keeps samples after deletion: store the sample ourselves and delete at both places, or switch the provider.
- The training opt-out is not available for our account: ask Mistral, otherwise use another provider with a DPA.
- The preview ends with a price or limit that breaks the budget of $100: go back to the provider option (the code has one module per provider).
- Latency is clearly worse than Fish Audio in the TTFA test (G6 target: p95 below 1.5 s).

## Open points

- Measure Mistral time to first audio with the existing TTFA test and compare with `docs/adr/0001-data`.
- Write down the audio quality comparison of issue #29 (no result is in the repo).
- Ask Mistral support: what happens at the end of `retention_notice`, where voice samples are stored, the limit of saved voices.
- Read the limits in the Mistral admin panel (requests per second, audio seconds per minute) and note the date. This decides whether the concurrency argument holds.
- Ask Fish Audio and Mistral support: is one account for many end users allowed, and is there a limit of stored voices?
- Measure how long one request stays open (Mistral and the mock), to refine the estimate above.
- On 2026-10-31 the single-user backend was switched because "Fish Audio no longer works" (commit message). The Fish docs list no breaking change (`s2-pro` and the WebSocket endpoint are still supported). Write the real cause here.
- Update `docs/goals.md` (G3, G6, G7, G8 still say "Fish Audio") and `deploy/` (still defaults to `fish`).

## Sources

All read on 2026-11-04.

Fish Audio:
- https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits (price, concurrency tiers)
- https://docs.fish.audio/features/voice-cloning and https://docs.fish.audio/features/manage-voices (clone, delete)
- https://docs.fish.audio/api-reference/errors.md and https://docs.fish.audio/api-reference/endpoint/model/create-model.md (429, create voice)
- https://fish.audio/plan/ (voice slots per web plan)
- https://docs.fish.audio/developer-guide/getting-started/changelog.md (changes, no breaking change for `s2-pro`)
- https://fish.audio/privacy/ (effective 2024-08-28) and https://fish.audio/terms/ (effective 2024-08-18)

Mistral:
- https://docs.mistral.ai/models/voxtral-mini-tts-3-0 (price, public preview)
- https://docs.mistral.ai/studio/audio/text-to-speech/voices and https://docs.mistral.ai/studio/audio/text-to-speech/voice-cloning (saved voices, `retention_notice`)
- https://legal.mistral.ai/terms/data-processing-addendum (DPA, training, entity)
- https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data (EU hosting)
- https://help.mistral.ai/en/articles/347612-can-i-activate-zero-data-retention-zdr (Zero Data Retention)
- https://docs.mistral.ai/admin/billing-usage/usage-limits and https://docs.mistral.ai/admin/workspaces/usage-limits (usage only per model and workspace, limits per workspace)
