-- One cloned voice per user (G3). Deleting a user in auth.users deletes their voice row (CASCADE).

create table public.user_voices (
    user_id      uuid   not null primary key references auth.users (id) on delete cascade,
    voice_id     text   not null,
    name         text   not null,
    created_at   bigint not null,
    consented_at bigint not null
);

-- RLS on and no policies: the public Supabase API cannot read this table.
-- Only the backend has access, and it filters every query by user_id.
alter table public.user_voices enable row level security;

-- Defense in depth: the API roles get no table privileges at all.
revoke all on public.user_voices from anon, authenticated;
