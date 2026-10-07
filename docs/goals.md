# myEcho Multi-User: Goals

Branch: `multiuser`. Status: draft v0.1 (2026-10-07).
Target size: 5–20 users. Time: 16 weeks (about 11 for engineering, 5 for writing and buffer). Budget: $100 (cloud $50, Fish Audio $30, reserve $20).

## Scope

| ID | Goal | Level | Acceptance criterion | Effort (h, rough) |
|---|---|---|---|---|
| G1 | Authentication with a managed OIDC provider. Backend only validates the JWT. | Must | A test reads all routes from the OpenAPI file. Every route except a minimal `/health` returns 401 without a valid token. `/health` no longer exposes Fish Audio credits. | 40–60 |
| G2 | Per-user data (Postgres, key `(user_id, id)`). `user_id` comes only from the token. | Must | Authorization matrix (resource: chat, message, usage, voice × operation: read, list, write, delete × actor: other user, no user). All cases return 403/404 and leak nothing. The same check runs under load with unique markers per user: 0 foreign markers found. | 30–50 |
| G3 | Own voice per user (clone from uploaded sample). | Must | Consent is stored before upload. A request from user B never uses user A's `voice_id` (test). Deleting an account also deletes the voice at Fish Audio. **Fallback:** one preset voice per user. | 30–50 |
| G4 | Cloud deployment: Hetzner VM, Docker Compose, Postgres, Caddy (HTTPS), Terraform. | Must | A working system from an empty project with one command (time is measured and written down). No public database port. One backup restore tested. | 30–40 |
| G5 | Load test of the own system with mock TTS. | Must | Thresholds below. | 40–50 |
| G6 | Load test of the whole chain with real Fish Audio. | Should | p95 time to first audio < 1.5 s at 20 users. Errors of Fish Audio are counted separately from own errors. The concurrency limit of the plan is recorded. | 10–15 |
| G7 | Usage metering per user and per-user quota. | Should (build before the first real-TTS test) | One row per TTS request: `user_id`, time, characters, bytes, status. The summed characters are within 5 % of the Fish Audio billing for the test period. | 10–15 |
| G8 | Data minimization (minimal version). | Must | Data inventory (data, place, purpose, retention). Account deletion removes all rows of the user (test). Logs contain no message text (test). Text is sent in the POST body, not in the URL. | 10–15 |

Total estimate: 200–295 h. Over 11 engineering weeks this is 18–27 h/week. Replace the estimates with real hours after week 2.

Out of scope: Kubernetes, autoscaling, own password handling, iOS, sync of phrases and statistics across devices, payments.

## Load test method (G5, G6)

- Tool: Locust. Load generator runs on a separate VM in the same region. Its CPU must stay below 70 %, otherwise the run is invalid.
- Levels (concurrent users): 5, 10, 20 (target), then 40, 80, 160 (stress, to find the tipping point).
- Per level: 1 min ramp-up, 5 min measurement. 3 runs per level, fixed random seed.
- User behavior: login, load chats, then speak a phrase every 10–20 s (uniform). Text length mix: 50 % short (≤ 20 characters), 35 % medium (≤ 80), 15 % long (≤ 200). This mix is an assumption. Adjust it with the real usage statistics of the app before the first run.
- Autoscaling is off. Instance count is fixed per experiment.
- Report: median and min–max of the 3 runs. No standard deviation (n = 3).

### Pass criteria at 20 users (own system, mock TTS)

| Metric | Threshold |
|---|---|
| p95 latency `GET /chats` | < 300 ms |
| p95 backend overhead for TTS (request received to first audio byte, minus mock delay) | < 100 ms |
| Error rate (5xx, timeouts, own system only) | < 1 % |
| Isolation violations | 0 |

### Derived results

- **Tipping point:** the first level where p95 exceeds a threshold or the error rate exceeds 5 %, and the same holds at the next level.
- **Maximum sustainable throughput:** highest completed requests/s at the last level before the tipping point.
- **Scaling efficiency:** max throughput with 2 instances divided by max throughput with 1 instance. Goal: ≥ 1.6.

## Rules

- The thresholds above are frozen before the first measurement. The commit hash of this file is quoted in the report.
- Weeks 1–2: baseline (mock TTS and Locust against the current system) and a voice clone spike (Fish Audio API: plan, price, number of voices, latency). Track hours.
- Week 3 checkpoint: compare real hours with the estimates. If behind, cut in this order: G6, G8 beyond the inventory, G3 clone (use the fallback).
- Week 11: feature freeze.
- Merge `main` into `multiuser` at least weekly.

## Open points

- Supervisor: is voice cloning required, and is a VM-based setup (IaaS) accepted as "cloud"?
- Fish Audio: where is data processed, and is a data processing agreement available?
- Hours per week are unknown.
