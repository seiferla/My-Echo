-- Chats and messages per user. Deleting a user in auth.users deletes their rows (CASCADE).

create table public.chats (
    user_id     uuid    not null references auth.users (id) on delete cascade,
    id          text    not null,
    title       text    not null,
    timestamp   bigint  not null,
    pinned      boolean not null default false,
    updated_at  bigint  not null,
    primary key (user_id, id)
);

create table public.messages (
    user_id     uuid    not null,
    id          text    not null,
    chat_id     text    not null,
    seq         integer not null,
    role        text    not null check (role in ('user', 'assistant')),
    content     text    not null,
    timestamp   bigint,
    via         text    check (via in ('send', 'save')),
    edit_count  integer not null default 0,
    primary key (user_id, id),
    foreign key (user_id, chat_id) references public.chats (user_id, id) on delete cascade
);

create index idx_messages_chat on public.messages (user_id, chat_id, seq);

-- RLS on and no policies: the public Supabase API cannot read these tables.
-- Only the backend has access, and it filters every query by user_id.
alter table public.chats enable row level security;
alter table public.messages enable row level security;

-- Defense in depth: the API roles get no table privileges at all.
revoke all on public.chats from anon, authenticated;
revoke all on public.messages from anon, authenticated;
