-- Application-boundary access for the React + Vite POS pilot.
-- A POS role and store membership are necessary but not sufficient: a member
-- also needs an active POS assignment, optionally narrowed to stores/roles.

create table if not exists public.application_registry (
  code text primary key check (code in ('HUB', 'ADMIN', 'PLAY', 'POS', 'KIOSK', 'QUEUE', 'GO')),
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('CONTROL_PLANE', 'PLATFORM_ADMIN', 'OPERATIONS', 'CONSUMER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.application_registry (code, name, kind) values
  ('HUB', 'Aevo Hub', 'CONTROL_PLANE'),
  ('ADMIN', 'Aevo Admin', 'PLATFORM_ADMIN'),
  ('PLAY', 'Aevo Play', 'CONSUMER'),
  ('POS', 'Aevo POS', 'OPERATIONS'),
  ('KIOSK', 'Aevo Kiosk', 'OPERATIONS'),
  ('QUEUE', 'Aevo Queue', 'OPERATIONS'),
  ('GO', 'Aevo Go', 'CONSUMER')
on conflict (code) do update set name = excluded.name, kind = excluded.kind, updated_at = timezone('utc', now());

create table if not exists public.member_app_assignments (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  application_code text not null references public.application_registry(code) on update cascade on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  starts_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (membership_id, application_code),
  check (expires_at is null or expires_at > starts_at)
);

create table if not exists public.member_app_scopes (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.member_app_assignments(id) on delete cascade,
  scope_type text not null check (scope_type in ('ORGANIZATION', 'STORE', 'RESOURCE', 'DEVICE_GROUP')),
  scope_ref text not null check (length(trim(scope_ref)) between 1 and 160),
  created_at timestamptz not null default timezone('utc', now()),
  unique (assignment_id, scope_type, scope_ref)
);

create table if not exists public.member_app_roles (
  assignment_id uuid not null references public.member_app_assignments(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (assignment_id, role_id)
);

insert into public.member_app_assignments (membership_id, application_code, status)
select m.id, 'HUB', 'ACTIVE'
from public.memberships m
where m.status = 'ACTIVE'
on conflict (membership_id, application_code) do nothing;

create or replace function public.assign_default_hub_application()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'ACTIVE' then
    insert into public.member_app_assignments (membership_id, application_code, status)
    values (new.id, 'HUB', 'ACTIVE')
    on conflict (membership_id, application_code) do update
      set status = 'ACTIVE', updated_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_default_hub_application on public.memberships;
create trigger memberships_default_hub_application
after insert or update of status on public.memberships
for each row
when (new.status = 'ACTIVE')
execute function public.assign_default_hub_application();

create index if not exists member_app_assignments_lookup_idx
  on public.member_app_assignments (membership_id, application_code, status, starts_at, expires_at);
create index if not exists member_app_scopes_lookup_idx
  on public.member_app_scopes (assignment_id, scope_type, scope_ref);

alter table public.application_registry enable row level security;
alter table public.member_app_assignments enable row level security;
alter table public.member_app_scopes enable row level security;
alter table public.member_app_roles enable row level security;

revoke all on table public.application_registry from public, anon, authenticated;
revoke all on table public.member_app_assignments from public, anon, authenticated;
revoke all on table public.member_app_scopes from public, anon, authenticated;
revoke all on table public.member_app_roles from public, anon, authenticated;
grant all on table public.application_registry to service_role;
grant all on table public.member_app_assignments to service_role;
grant all on table public.member_app_scopes to service_role;
grant all on table public.member_app_roles to service_role;
