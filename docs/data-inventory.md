# myEcho Multi-User: Data inventory

Status: 2026-10-22, branch `multiuser`. Goal G8 in [goals.md](goals.md).
Every row is personal data unless it says otherwise. "Account deletion" means the admin
deletes the user in Supabase Auth; all rows follow through `ON DELETE CASCADE` (tested).

| Data | Where it is stored | Purpose | How long / how it is deleted | Who processes it |
|---|---|---|---|---|
| Account: email, password hash, user ID | Supabase Auth, Ireland (`eu-west-1`) | Login | Until account deletion | Supabase |
| Session tokens (access + refresh token) | Phone, SecureStore (split into chunks) | Stay signed in | Removed at logout. Access token valid 1 h, see [ADR 0002](adr/0002-supabase-auth-and-database.md) | – |
| Chats and messages (text) | Supabase Postgres, Ireland, table `chats`, `messages` | History on every device | Until the user deletes the chat, or account deletion | Supabase |
| Chats and messages (text), local copy | Phone, file per account (`chats.<user_id>.json`) | Offline use, fast start | Stays after logout. Removed only by uninstalling the app | – |
| Quick phrases and their settings | Supabase Postgres (`phrase_stores`) and phone (`phrases.<user_id>.json`) | Same phrases on every device | Postgres: until account deletion. Phone: stays after logout | Supabase |
| TTS statistics per day (count, characters, duration, no text) | Supabase Postgres (`tts_daily_stats`) and phone | Statistics page | Postgres: until account deletion. Phone: stays after logout | Supabase |
| Synthesized audio of messages | Phone only, folder per account (`tts-cache.<user_id>`), at most 100 MB | Replay without network and cost | Oldest files removed above 100 MB, or "Clear cache" in the app. Stays after logout | – |
| Message text sent for speech | In transit: app → backend → Fish Audio | Speech synthesis | Backend does not store it. Fish Audio retention unknown | Fish Audio (location and DPA unknown) |
| Backend logs | Backend host (Docker logs) | Operation, errors | Host default. No message text: app logs only lengths, the access log drops the query string (tested) | Host |
| Metrics | Prometheus | Monitoring | 90 days. Route templates and status codes, no user IDs, no text | Own Prometheus |
| Voice samples and voice model (planned, G3) | Fish Audio | Own voice per user | Must be deleted with the account (Fish "Delete Model" API) | Fish Audio |

## Open points

- **Fish Audio:** no data processing agreement found, location of processing unknown. Ask Fish Audio before real users start.
- **Local data on the phone** stays after logout by design (phrases and statistics would otherwise be lost). A "delete data on this device" option does not exist yet.
- **Account deletion** is only possible by the admin in Supabase. There is no deletion in the app, and it does not delete a voice at Fish Audio yet (G3, G8).
- **Message text in the URL** (`/stream/tts?text=…`): hidden from the backend access log, but a reverse proxy (Caddy, G4) must not log query strings either.
