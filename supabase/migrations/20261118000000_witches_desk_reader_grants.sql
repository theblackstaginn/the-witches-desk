-- Short-lived capability grants for the read-only mobile ChatGPT handoff.
-- The application user cannot read or write this table; the Edge Function uses
-- the server-side service role and binds each grant to the verified owner_id.
create table if not exists witches_desk.reader_grants (
  request_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists reader_grants_expires_at_idx
  on witches_desk.reader_grants (expires_at);

alter table witches_desk.reader_grants enable row level security;

revoke all on table witches_desk.reader_grants from anon, authenticated;
grant all on table witches_desk.reader_grants to service_role;
