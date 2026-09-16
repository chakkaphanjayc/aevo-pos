-- Aevo POS Phase 0 foundation for Supabase/Postgres.
--
-- All application tables are tenant-scoped. The API uses the Supabase
-- server-only key, while these policies keep accidental direct access safe and
-- make the same schema ready for publishable-key clients later.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  display_name text not null default '' check (length(display_name) <= 160),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, code)
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  timezone text not null default 'Asia/Bangkok' check (length(timezone) between 1 and 64),
  currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, code)
);

-- Keep the store id and tenant id addressable as a composite key. Catalog
-- tables use this key in their foreign keys so a row can never point at a
-- store from another organization, even if an id is copied accidentally.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stores'::regclass
      and conname = 'stores_organization_id_id_key'
  ) then
    alter table public.stores
      add constraint stores_organization_id_id_key unique (organization_id, id);
  end if;
end;
$$;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('OWNER', 'ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'KITCHEN', 'STAFF', 'VIEWER')),
  name text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.permissions (
  code text primary key,
  description text not null
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('INVITED', 'ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, user_id)
);

create table if not exists public.membership_stores (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (membership_id, store_id)
);

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (length(trim(event_type)) between 1 and 120),
  aggregate_type text not null check (length(trim(aggregate_type)) between 1 and 80),
  aggregate_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  domain_event_id uuid not null unique references public.domain_events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  locked_until timestamptz,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  scope text not null check (length(trim(scope)) between 1 and 120),
  key text not null check (length(trim(key)) between 8 and 200),
  response_status integer,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, scope, key)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (length(trim(action)) between 1 and 120),
  resource_type text not null check (length(trim(resource_type)) between 1 and 80),
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists memberships_user_status_idx on public.memberships (user_id, status, created_at);
create index if not exists memberships_org_status_idx on public.memberships (organization_id, status, created_at);
create index if not exists membership_stores_store_idx on public.membership_stores (store_id, membership_id);
create index if not exists stores_org_status_name_idx on public.stores (organization_id, status, name);
create index if not exists brands_org_status_name_idx on public.brands (organization_id, status, name);
create index if not exists domain_events_org_occurred_idx on public.domain_events (organization_id, occurred_at desc);
create index if not exists outbox_pending_idx on public.outbox_events (status, available_at, created_at);
create index if not exists outbox_org_idx on public.outbox_events (organization_id, status, created_at);
create index if not exists idempotency_expiry_idx on public.idempotency_keys (expires_at);
create index if not exists audit_org_created_idx on public.audit_logs (organization_id, created_at desc);

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at before update on public.user_profiles
for each row execute function public.set_updated_at();
drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at before update on public.brands
for each row execute function public.set_updated_at();
drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at before update on public.stores
for each row execute function public.set_updated_at();
drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at before update on public.roles
for each row execute function public.set_updated_at();
drop trigger if exists memberships_set_updated_at on public.memberships;
create trigger memberships_set_updated_at before update on public.memberships
for each row execute function public.set_updated_at();
drop trigger if exists outbox_events_set_updated_at on public.outbox_events;
create trigger outbox_events_set_updated_at before update on public.outbox_events
for each row execute function public.set_updated_at();

insert into public.permissions (code, description) values
  ('organization.manage', 'Manage organization settings'),
  ('store.read', 'View stores'),
  ('store.manage', 'Manage stores'),
  ('member.manage', 'Manage organization members'),
  ('catalog.read', 'View catalog'),
  ('catalog.manage', 'Manage catalog'),
  ('order.read', 'View orders'),
  ('order.create', 'Create orders'),
  ('payment.receive', 'Receive payments'),
  ('refund.create', 'Create refunds'),
  ('order.void', 'Void orders'),
  ('price.override', 'Override prices'),
  ('cash_drawer.open', 'Open cash drawer'),
  ('integration.manage', 'Manage integrations'),
  ('audit.read', 'View audit logs')
on conflict (code) do update set description = excluded.description;

insert into public.roles (code, name, is_system) values
  ('OWNER', 'Owner', true),
  ('ADMIN', 'Admin', true),
  ('BRANCH_MANAGER', 'Branch manager', true),
  ('CASHIER', 'Cashier', true),
  ('KITCHEN', 'Kitchen', true),
  ('STAFF', 'Staff', true),
  ('VIEWER', 'Viewer', true)
on conflict (code) do update set name = excluded.name, is_system = excluded.is_system;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r cross join public.permissions p
where r.code in ('OWNER', 'ADMIN')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.permission_code
from public.roles r
cross join (values
  ('store.read'), ('catalog.read'), ('catalog.manage'), ('order.read'),
  ('order.create'), ('payment.receive'), ('refund.create'), ('order.void'),
  ('price.override'), ('cash_drawer.open'), ('audit.read')
) as v(permission_code)
where r.code = 'BRANCH_MANAGER'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.permission_code
from public.roles r
cross join (values ('store.read'), ('catalog.read'), ('order.read'), ('order.create'), ('payment.receive')) as v(permission_code)
where r.code = 'CASHIER'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.permission_code
from public.roles r
cross join (values ('store.read'), ('order.read')) as v(permission_code)
where r.code = 'KITCHEN'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.permission_code
from public.roles r
cross join (values ('store.read'), ('catalog.read'), ('order.read'), ('order.create')) as v(permission_code)
where r.code = 'STAFF'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.permission_code
from public.roles r
cross join (values ('store.read'), ('order.read')) as v(permission_code)
where r.code = 'VIEWER'
on conflict do nothing;

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE'
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  );
$$;

create or replace function private.has_org_permission(target_organization_id uuid, required_permission text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE'
    join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_code = required_permission
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  );
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_permission(uuid, text) from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_permission(uuid, text) to authenticated;
revoke all on function public.set_updated_at() from public;

alter table public.user_profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.brands enable row level security;
alter table public.stores enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_stores enable row level security;
alter table public.domain_events enable row level security;
alter table public.outbox_events enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists user_profiles_select_self on public.user_profiles;
create policy user_profiles_select_self on public.user_profiles
for select to authenticated using (id = auth.uid());

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
for select to authenticated using (private.is_org_member(id));
drop policy if exists organizations_manage on public.organizations;
create policy organizations_manage on public.organizations
for all to authenticated using (private.has_org_permission(id, 'organization.manage'))
with check (private.has_org_permission(id, 'organization.manage'));

drop policy if exists brands_select_member on public.brands;
create policy brands_select_member on public.brands
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists brands_manage on public.brands;
create policy brands_manage on public.brands
for all to authenticated using (private.has_org_permission(organization_id, 'organization.manage'))
with check (private.has_org_permission(organization_id, 'organization.manage'));

drop policy if exists stores_select_member on public.stores;
create policy stores_select_member on public.stores
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists stores_manage on public.stores;
create policy stores_manage on public.stores
for all to authenticated using (
  private.has_org_permission(organization_id, 'organization.manage')
  or private.has_org_permission(organization_id, 'store.manage')
)
with check (
  private.has_org_permission(organization_id, 'organization.manage')
  or private.has_org_permission(organization_id, 'store.manage')
);

drop policy if exists memberships_select_member on public.memberships;
create policy memberships_select_member on public.memberships
for select to authenticated using (user_id = auth.uid() or private.is_org_member(organization_id));
drop policy if exists memberships_manage on public.memberships;
create policy memberships_manage on public.memberships
for all to authenticated using (private.has_org_permission(organization_id, 'member.manage'))
with check (private.has_org_permission(organization_id, 'member.manage'));

drop policy if exists membership_stores_select_member on public.membership_stores;
create policy membership_stores_select_member on public.membership_stores
for select to authenticated using (
  exists (
    select 1 from public.memberships m
    where m.id = membership_id and (m.user_id = auth.uid() or private.is_org_member(m.organization_id))
  )
);
drop policy if exists membership_stores_manage on public.membership_stores;
create policy membership_stores_manage on public.membership_stores
for all to authenticated using (
  exists (
    select 1 from public.memberships m
    where m.id = membership_id and private.has_org_permission(m.organization_id, 'member.manage')
  )
)
with check (
  exists (
    select 1 from public.memberships m
    where m.id = membership_id and private.has_org_permission(m.organization_id, 'member.manage')
  )
);

-- domain_events, outbox_events, idempotency_keys and audit_logs intentionally
-- have no authenticated policies. They are written by trusted API/worker code
-- with the server-only Supabase key, never directly by a browser.
