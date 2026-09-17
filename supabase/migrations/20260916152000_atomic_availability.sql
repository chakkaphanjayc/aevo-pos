-- Aevo POS Phase 1 atomic availability PATCH operation.

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

create or replace function public.patch_product_availability(
  p_organization_id uuid,
  p_store_id uuid,
  p_product_id uuid,
  p_channel text,
  p_is_available boolean default null,
  p_is_available_set boolean default false,
  p_sold_out boolean default null,
  p_sold_out_set boolean default false,
  p_price_override_minor integer default null,
  p_price_override_set boolean default false
)
returns table (
  channel text,
  is_available boolean,
  sold_out boolean,
  price_override_minor integer
)
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  return query
  insert into public.product_availability as availability (
    organization_id,
    store_id,
    product_id,
    channel,
    is_available,
    sold_out,
    price_override_minor
  ) values (
    p_organization_id,
    p_store_id,
    p_product_id,
    p_channel,
    case when p_is_available_set then coalesce(p_is_available, true) else true end,
    case when p_sold_out_set then coalesce(p_sold_out, false) else false end,
    case when p_price_override_set then p_price_override_minor else null end
  )
  on conflict (organization_id, store_id, product_id, channel) do update
  set is_available = case when p_is_available_set then excluded.is_available else availability.is_available end,
      sold_out = case when p_sold_out_set then excluded.sold_out else availability.sold_out end,
      price_override_minor = case when p_price_override_set then excluded.price_override_minor else availability.price_override_minor end
  returning availability.channel, availability.is_available, availability.sold_out, availability.price_override_minor;
end;
$function$;

revoke all on function public.patch_product_availability(
  uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, integer, boolean
) from public, anon, authenticated;
grant execute on function public.patch_product_availability(
  uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, integer, boolean
) to service_role;
