-- Schnellphrasen und TTS-Statistik pro Nutzer (G2, G8).
-- Wie bei chats: user_id verweist auf auth.users, beim Löschen eines Nutzers
-- verschwinden die Zeilen automatisch (ON DELETE CASCADE).

-- Phrasen + Anzeige-Einstellungen: ein Datensatz pro Nutzer.
-- data = {"phrases": [...], "settings": {...}}; updated_at = Zeitstempel der
-- letzten Änderung (ms). Der neuere Stand gewinnt.
create table public.phrase_stores (
    user_id     uuid   primary key references auth.users (id) on delete cascade,
    data        jsonb  not null,
    updated_at  bigint not null
);

-- TTS-Statistik: ein Datensatz pro Nutzer und Tag (Tag wie in der App: YYYY-MM-DD).
create table public.tts_daily_stats (
    user_id      uuid    not null references auth.users (id) on delete cascade,
    day          text    not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
    requests     integer not null check (requests >= 0),
    chars        integer not null check (chars >= 0),
    duration_ms  bigint  not null check (duration_ms >= 0),
    primary key (user_id, day)
);

-- RLS an, ohne Policies, und die API-Rollen sehen die Tabellen nicht einmal.
-- Der Zugriff läuft nur über das Backend (filtert nach user_id).
alter table public.phrase_stores enable row level security;
alter table public.tts_daily_stats enable row level security;

revoke all on public.phrase_stores from anon, authenticated;
revoke all on public.tts_daily_stats from anon, authenticated;
