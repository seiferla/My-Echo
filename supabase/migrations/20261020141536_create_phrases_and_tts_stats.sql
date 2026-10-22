-- Quick phrases and TTS statistics per user. Same rules as chats (CASCADE, RLS, no API access).

-- One row per user: data = {"phrases": [...], "settings": {...}}.
-- updated_at = last change in ms; the newer store wins.
create table public.phrase_stores (
    user_id     uuid   primary key references auth.users (id) on delete cascade,
    data        jsonb  not null,
    updated_at  bigint not null
);

-- One row per user and day (YYYY-MM-DD, as in the app).
create table public.tts_daily_stats (
    user_id      uuid    not null references auth.users (id) on delete cascade,
    day          text    not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
    requests     integer not null check (requests >= 0),
    chars        integer not null check (chars >= 0),
    duration_ms  bigint  not null check (duration_ms >= 0),
    primary key (user_id, day)
);

alter table public.phrase_stores enable row level security;
alter table public.tts_daily_stats enable row level security;

revoke all on public.phrase_stores from anon, authenticated;
revoke all on public.tts_daily_stats from anon, authenticated;
