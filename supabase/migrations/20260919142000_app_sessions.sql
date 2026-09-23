-- Server-managed POS application sessions. Browser cookies contain only an
-- opaque token; Supabase access/refresh tokens stay encrypted server-side.

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_code text not null references public.application_registry(code) on update cascade on delete restrict,
  token_hash text not null unique,
  csrf_token_hash text not null,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  access_expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references public.app_sessions(id) on delete set null,
  check (idle_expires_at <= absolute_expires_at),
  check (access_expires_at <= absolute_expires_at)
);

create index if not exists app_sessions_app_active_idx
  on public.app_sessions (app_code, user_id, revoked_at, absolute_expires_at);

alter table public.app_sessions enable row level security;
revoke all on table public.app_sessions from public, anon, authenticated;
grant all on table public.app_sessions to service_role;
