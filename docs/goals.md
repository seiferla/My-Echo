# myEcho Multi-User: Goals

- Status: draft v0.1 (2026-10-07).
- Target size: 5–20 users.
- Budget: $100

## Scope

| ID | Goal | Level | Acceptance criterion | 
|---|---|---|---|
| G1 | Authentication with Supabase Auth (managed). Backend validates the JWT (JWKS) and takes `user_id` from `sub`. Sign-ups are off, the admin creates the accounts. | Must | A test reads all routes from the OpenAPI file. Every route except a minimal `/health` returns 401 without a valid token. `/health` no longer exposes Fish Audio credits. `/metrics`, `/docs` and `/openapi.json` are not public. **Accessible login:** sign-in works with TalkBack without sighted help, pasting works in all fields, no CAPTCHA, session lifetime is stated in the ADR. **Passkey spike:** passkey sign-in works on a real Android phone without typing, or the fallback (password with paste) is documented. |
| G2 | Per-user data in Postgres (Supabase), key `(user_id, id)`. Chats go through the FastAPI backend. `user_id` comes only from the token. RLS is on for every table (deny by default). | Must | Authorization matrix (resource: chat, message, usage, voice × operation: read, list, write, delete × actor: other user, no user). All cases return 403/404 and leak nothing. A test fails if any table has RLS off. The same check runs under load with unique markers per user: 0 foreign markers found. | 
| G3 | Own voice per user (clone from uploaded sample). | Must | Consent is stored before upload. A request from user B never uses user A's `voice_id` (test). Deleting an account also deletes the voice at Fish Audio. **Fallback:** one preset voice per user. | 
| G4 | Backend deployed as code (Terraform): Hetzner VM, Docker Compose, Caddy (HTTPS) on an own domain. Database and auth at Supabase (Frankfurt). Schema comes from migration files in the repo. | Must | A working backend from an empty VM project with one command (time is measured and written down). Schema applied from the migration files. No secrets in the repo. One backup restore tested. |
| G5 | Load test of the own system with mock TTS, in two setups. **E1:** backend + Postgres container (baseline). **E2:** backend + Supabase Postgres (real setup). | Must | Thresholds below, measured in E2. The difference E2 − E1 is reported as the cost of the managed database. |
| G6 | Load test of the whole chain with real Fish Audio. | Should | p95 time to first audio < 1.5 s at 20 users. Errors of Fish Audio are counted separately from own errors. The concurrency limit of the plan is recorded. | 
| G7 | Usage metering per user and per-user quota. | Should (build before the first real-TTS test) | One row per TTS request: `user_id`, time, characters, bytes, status. The summed characters are within 5 % of the Fish Audio billing for the test period. | 
| G8 | Data minimization (minimal version). | Must | Data inventory (data, place, purpose, retention, processors: Supabase, Fish Audio). User tables reference the auth user with `ON DELETE CASCADE`. Account deletion removes the user in Supabase Auth and all rows (test). Logs contain no message text (test). Text is sent in the POST body, not in the URL. |


## Load test method (G5, G6)

- Tool: Locust. Load generator runs on a separate VM in the same region. Its CPU must stay below 70 %, otherwise the run is invalid.
- Levels (concurrent users): 5, 10, 20 (target), then 40, 80, 160 (stress, to find the tipping point). E1 runs all levels. E2 runs 5, 10, 20 only (cost, and Supabase terms for load tests must be checked first).
- E2 uses a separate Supabase project for tests, same region and plan as production. Plan and compute size are written in the report. The database pool size of the backend is set explicitly. Runs are repeated at different times of day (shared hardware).
- Per level: 1 min ramp-up, 5 min measurement. 3 runs per level, fixed random seed.
- User behavior: load chats (tokens are issued before the test, no login load on Supabase), then speak a phrase every 10–20 s (uniform). Text length mix: 50 % short (≤ 20 characters), 35 % medium (≤ 80), 15 % long (≤ 200). This mix is an assumption. Adjust it with the real usage statistics of the app before the first run.
- Autoscaling is off. Instance count is fixed per experiment.
- Report: median and min–max of the 3 runs. No standard deviation (n = 3).

### Pass criteria at 20 users (E2, mock TTS)

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
