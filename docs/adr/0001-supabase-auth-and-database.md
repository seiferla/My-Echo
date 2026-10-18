# ADR 0001: Supabase for authentication and database

Status: proposed (2026-10-18). Related: goals G1, G2, G4, G5, G8; issue #208.

## Context

myEcho must support 5–20 users with isolated data, login, and a measurable scaling behavior. Users have voice disorders, so login must be accessible. Time: about 11 engineering weeks. Budget: $100 in total. Data is sensitive (GDPR), so an EU region is required.

## Options

| Option | Reason against |
|---|---|
| Keycloak (self-hosted) | Own operation (updates, security, Java memory use). Costs time that is not available. |
| Auth0 | Cloud-only, so tests run against the cloud. No database. Free-tier terms and EU tenant to be checked. |
| Firebase | Firestore is NoSQL, the data is relational. Google lock-in. EU data location for auth unclear. |
| **Supabase** | Chosen. |

Not criteria: user limits (25,000 and 50,000 are far above 20 users) and "free".

## Decision

1. **Auth:** Supabase Auth, managed, region Frankfurt. The FastAPI backend validates the access token with the project's public keys (JWKS), checks `exp`, `iss`, `aud`, pins the algorithms, and takes `user_id` from `sub`. The backend never handles refresh tokens.
2. **Data:** Supabase managed Postgres. **All chat CRUD goes through the FastAPI backend** (option X). The app does not use the Supabase data API.
3. **RLS:** enabled on every table, no public policies (deny by default). The backend filters by `user_id` in every query. A test fails if a table has RLS off.
4. **Accounts:** public sign-ups off. The admin creates users with a password and a confirmed email. Passwords are reset by the admin. No SMTP is needed.
5. **Passkeys:** added after the first password login, as a time-boxed spike (2 days). Needs a development build, `react-native-passkeys`, and a domain with Digital Asset Links.
6. **Hosting of the backend:** Hetzner VM, Docker Compose, Caddy, Terraform, own domain (HTTPS is required by release Android builds, and passkeys need the domain).
7. **Load tests:** E1 (backend + Postgres container) as baseline, E2 (backend + Supabase Postgres) as real setup, in a separate Supabase test project. Tokens are issued before the test.

## Consequences

- Ops work is lower than with Keycloak or a self-hosted database.
- The database in E2 is shared hardware at a fixed plan size. Results vary, and the plan limits can be the tipping point. E1 keeps the attribution clean.
- Switching provider later means a data export (`pg_dump`) and a new JWKS URL. No code rewrite, as long as the backend uses only standard JWT validation.
- Passwords need a long session and a device unlock to stay accessible. Magic link and custom SMTP are postponed.

## Reversal triggers

- Passkey spike fails after 2 days: ship password with paste, passkeys become future work. Supabase stays.
- The EU region or data processing agreement is not available: switch to Keycloak or Auth0 for login plus a self-hosted Postgres.
- Supabase terms forbid load tests on E2: run E2 at low levels only and state it in the report.
- The free plan cannot meet the load levels: pay one month of a paid plan for the measurement window, within the budget.

## To verify before status "accepted"

- EU region (Frankfurt) and data processing agreement.
- Free-plan rules: pausing, backups (point-in-time restore), rate limits.
- Terms for load tests.
- Local Supabase stack (CLI, Docker) for isolation tests in CI.
- `react-native-passkeys` with the app's Expo SDK version.
- Whether the JWT signing keys of the project are asymmetric (JWKS) or a shared secret.

## Sources

- https://supabase.com/docs/guides/auth/passkeys (passkeys are experimental, API may change; low-level `auth.passkey` API for native flows; no Expo guide)
- https://supabase.com/docs/guides/auth/rate-limits (built-in email: about 2 per hour, only for authorized addresses)
- https://unpkg.com/react-native-passkeys@0.4.1/README.md (Expo module, development build needed, domain association)
