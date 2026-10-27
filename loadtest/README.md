# Load test (goal G5)

Method and limits: [docs/goals.md](../docs/goals.md), section "Load test method". Issue #218.
The test measures **our own system** (backend, token check, database). Speech is a mock
(`TTS_PROVIDER=mock`), so it costs nothing and needs no Fish Audio key.

## Setup E1 (this folder, as it is today)

Backend (1 Uvicorn worker) + local Supabase Postgres container + Locust. Tokens come from the local
Supabase Auth, issued **before** the test (no logins during the run).
Limits: all three parts run on **one machine**, so the numbers are a first baseline.
The final numbers need the load generator on a separate VM (goals.md).

## Run it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt -r loadtest/requirements.txt
npx supabase start                                 # local Postgres and Auth
python loadtest/run_baseline.py --quick --users 5  # about 1 minute, tests the setup, results are not kept
python loadtest/run_baseline.py                    # levels 5, 10, 20, 3 runs each, about 1 hour
python loadtest/summarize.py loadtest/results/<folder printed at the end>
python loadtest/prepare.py cleanup                 # removes the test users again
```

Stress levels for the tipping point: `--users 40 80 160`. Cloud database (setup E2): set `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL` of a **separate test project** and use `--tag E2`.
Check Supabase's terms for load tests first (ADR 0002).

Do not use the machine for anything else during a run, and keep it awake.

## What a simulated user does

1. Loads the chats once.
2. Every 10 to 20 s sends a message: saves the chat (`PUT /chats/...`) and speaks it (`GET /stream/tts`).
   Texts: 50 % up to 20 characters, 35 % up to 80, 15 % up to 200. Texts and waiting times are the same in
   every run (`--seed`).
3. Every second round it reloads the chats, so there are `GET /chats` samples inside the measurement window.
   (This differs from goals.md, which loads the chats once: the ramp-up values are discarded, so a single
   load per user would leave no samples.)

One run = 60 s ramp-up (values discarded) + 300 s measurement. Median and range over 3 runs.

## Numbers and how to read them

| Name in the CSV | Meaning |
|---|---|
| `/chats GET`, `/chats PUT` | database-backed requests |
| `/stream/tts [headers]` | time to the response headers. They arrive at once, so this is only for information |
| `/stream/tts [first audio byte]` | time to the first byte of the **audio**, the number that matters |
| `/stream/tts [overhead]` | the same minus the mock delay (read from the `X-TTS-Mock-First-Audio-Ms` header) = what our system adds |
| `/stream/tts [total]` | time until the whole audio has arrived |

**Isolation:** after every run each user reads their chats. They must see only their own chat, only messages
with their own marker (`LT<user>-`), and exactly as many as they saved. Result in `isolation.json`.

**Invalid runs** (excluded from the summary): load generator above 70 % CPU, Locust did not end cleanly, or the
isolation check did not run for every user. `resources.csv` has CPU and memory of backend and Locust every 5 s.

## Files

| File | Content |
|---|---|
| `run_baseline.py` | runs the levels, starts a fresh backend per run, writes `meta.json` (commit, machine, settings) |
| `locustfile.py` | the simulated user |
| `prepare.py` | test users, tokens, cleanup |
| `summarize.py` | median and range, limits, `summary.md` and `runs.csv` |
| `test_loadtest.py` | tests for text mix and summary logic: `pytest loadtest` |
| `results/` | one folder per series. Quick test runs (`quick-*`) are not committed |
