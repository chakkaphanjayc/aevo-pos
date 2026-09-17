-- Aevo POS Phase 1 hardening for projects that applied the first catalog
-- migration before the tenant-key and uniqueness fixes were available.

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

do $$
begin
  if exists (
    select 1
    from public.menu_items
    where variant_id is null
    group by organization_id, menu_id, product_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'Cannot add the no-variant menu item uniqueness index: duplicate legacy menu_items exist';
  end if;
end;
$$;

create unique index if not exists menu_items_without_variant_unique_idx
  on public.menu_items (organization_id, menu_id, product_id)
  where variant_id is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- This event-trigger helper is provisioned by some Supabase projects. It is
-- not an application RPC and must not be callable through the Data API.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
