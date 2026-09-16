-- Aevo POS Phase 1 catalog foundation.
--
-- Catalog records are organization-scoped. Store/channel availability is
-- modeled separately so the same product can be reused by multiple menus and
-- storefronts without changing historical order snapshots.

-- The foundation migration predates tenant-safe composite store references.
-- Add the referenced key here as well so this migration can be applied to an
-- existing project where the foundation tables already exist.
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

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, code),
  unique (organization_id, slug),
  foreign key (organization_id, parent_id)
    references public.categories(organization_id, id) on delete restrict
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  sku text not null check (length(trim(sku)) between 1 and 64),
  name text not null check (length(trim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 2000),
  base_price_minor integer not null default 0 check (base_price_minor >= 0),
  currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, sku),
  foreign key (organization_id, category_id)
    references public.categories(organization_id, id) on delete restrict
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  price_minor integer not null check (price_minor >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, id, product_id),
  unique (organization_id, product_id, code),
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete cascade
);

create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  channel text not null default 'POS' check (channel in ('POS', 'QR', 'KIOSK', 'PICKUP', 'STAFF', 'API')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, store_id, code),
  foreign key (organization_id, store_id)
    references public.stores(organization_id, id) on delete cascade
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  menu_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  price_override_minor integer check (price_override_minor is null or price_override_minor >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_available boolean not null default true,
  sold_out boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, menu_id, product_id, variant_id),
  foreign key (organization_id, menu_id)
    references public.menus(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id, product_id)
    references public.product_variants(organization_id, id, product_id) on delete restrict
);

-- A normal UNIQUE constraint treats NULL variant ids as distinct. This partial
-- index keeps a product from being added repeatedly to the same menu when it
-- has no selected variant, while still allowing one row per concrete variant.
create unique index if not exists menu_items_without_variant_unique_idx
  on public.menu_items (organization_id, menu_id, product_id)
  where variant_id is null;

create table if not exists public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  selection_type text not null default 'SINGLE' check (selection_type in ('SINGLE', 'MULTIPLE')),
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= min_selections),
  required boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, code)
);

create table if not exists public.modifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modifier_group_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  price_delta_minor integer not null default 0,
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, modifier_group_id, code),
  foreign key (organization_id, modifier_group_id)
    references public.modifier_groups(organization_id, id) on delete cascade
);

create table if not exists public.menu_item_modifier_groups (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  menu_item_id uuid not null,
  modifier_group_id uuid not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, menu_item_id, modifier_group_id),
  foreign key (organization_id, menu_item_id)
    references public.menu_items(organization_id, id) on delete cascade,
  foreign key (organization_id, modifier_group_id)
    references public.modifier_groups(organization_id, id) on delete cascade
);

create table if not exists public.product_availability (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  product_id uuid not null,
  channel text not null check (channel in ('POS', 'QR', 'KIOSK', 'PICKUP', 'STAFF', 'API')),
  is_available boolean not null default true,
  sold_out boolean not null default false,
  price_override_minor integer check (price_override_minor is null or price_override_minor >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, store_id, product_id, channel),
  foreign key (organization_id, store_id)
    references public.stores(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete cascade
);

create index if not exists categories_org_status_order_idx
  on public.categories (organization_id, status, sort_order, name);
create index if not exists products_org_status_name_idx
  on public.products (organization_id, status, name);
create index if not exists product_variants_product_status_idx
  on public.product_variants (organization_id, product_id, status, sort_order);
create index if not exists menus_store_channel_status_idx
  on public.menus (organization_id, store_id, channel, status);
create index if not exists menu_items_menu_order_idx
  on public.menu_items (organization_id, menu_id, sort_order);
create index if not exists modifiers_group_order_idx
  on public.modifiers (organization_id, modifier_group_id, sort_order);
create index if not exists availability_store_channel_idx
  on public.product_availability (organization_id, store_id, channel, is_available, sold_out);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at before update on public.product_variants
for each row execute function public.set_updated_at();
drop trigger if exists menus_set_updated_at on public.menus;
create trigger menus_set_updated_at before update on public.menus
for each row execute function public.set_updated_at();
drop trigger if exists menu_items_set_updated_at on public.menu_items;
create trigger menu_items_set_updated_at before update on public.menu_items
for each row execute function public.set_updated_at();
drop trigger if exists modifier_groups_set_updated_at on public.modifier_groups;
create trigger modifier_groups_set_updated_at before update on public.modifier_groups
for each row execute function public.set_updated_at();
drop trigger if exists modifiers_set_updated_at on public.modifiers;
create trigger modifiers_set_updated_at before update on public.modifiers
for each row execute function public.set_updated_at();
drop trigger if exists product_availability_set_updated_at on public.product_availability;
create trigger product_availability_set_updated_at before update on public.product_availability
for each row execute function public.set_updated_at();

grant select, insert, update, delete on
  public.categories,
  public.products,
  public.product_variants,
  public.menus,
  public.menu_items,
  public.modifier_groups,
  public.modifiers,
  public.menu_item_modifier_groups,
  public.product_availability
to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'categories', 'products', 'product_variants', 'menus', 'menu_items',
    'modifier_groups', 'modifiers', 'menu_item_modifier_groups',
    'product_availability'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

drop policy if exists categories_select_member on public.categories;
create policy categories_select_member on public.categories
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists categories_manage on public.categories;
create policy categories_manage on public.categories
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists products_select_member on public.products;
create policy products_select_member on public.products
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists products_manage on public.products;
create policy products_manage on public.products
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists product_variants_select_member on public.product_variants;
create policy product_variants_select_member on public.product_variants
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists product_variants_manage on public.product_variants;
create policy product_variants_manage on public.product_variants
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists menus_select_member on public.menus;
create policy menus_select_member on public.menus
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists menus_manage on public.menus;
create policy menus_manage on public.menus
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists menu_items_select_member on public.menu_items;
create policy menu_items_select_member on public.menu_items
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists menu_items_manage on public.menu_items;
create policy menu_items_manage on public.menu_items
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists modifier_groups_select_member on public.modifier_groups;
create policy modifier_groups_select_member on public.modifier_groups
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists modifier_groups_manage on public.modifier_groups;
create policy modifier_groups_manage on public.modifier_groups
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists modifiers_select_member on public.modifiers;
create policy modifiers_select_member on public.modifiers
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists modifiers_manage on public.modifiers;
create policy modifiers_manage on public.modifiers
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists menu_item_modifier_groups_select_member on public.menu_item_modifier_groups;
create policy menu_item_modifier_groups_select_member on public.menu_item_modifier_groups
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists menu_item_modifier_groups_manage on public.menu_item_modifier_groups;
create policy menu_item_modifier_groups_manage on public.menu_item_modifier_groups
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));

drop policy if exists product_availability_select_member on public.product_availability;
create policy product_availability_select_member on public.product_availability
for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists product_availability_manage on public.product_availability;
create policy product_availability_manage on public.product_availability
for all to authenticated
using (private.has_org_permission(organization_id, 'catalog.manage'))
with check (private.has_org_permission(organization_id, 'catalog.manage'));
