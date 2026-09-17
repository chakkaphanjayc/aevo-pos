-- Aevo POS Phase 2: one tenant-safe Order aggregate.
--
-- Orders from POS, QR, kiosk, pickup, staff and API channels share these
-- tables.  Creation, payment and lifecycle transitions are database functions
-- so the order, immutable item snapshots and domain outbox event commit as a
-- single transaction.

alter table if exists public.idempotency_keys
  add column if not exists resource_id uuid;

create table if not exists public.order_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  next_value integer not null default 1 check (next_value > 0),
  primary key (organization_id, store_id, business_date),
  foreign key (organization_id, store_id)
    references public.stores(organization_id, id) on delete cascade
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  order_number text not null check (order_number ~ '^SO-[0-9]{8}-[0-9]{5,}$'),
  channel text not null check (channel in ('POS', 'QR', 'KIOSK', 'PICKUP', 'STAFF', 'API')),
  fulfillment_type text not null check (fulfillment_type in ('TAKEAWAY', 'DINE_IN', 'PICKUP')),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'QUEUED', 'ACCEPTED',
    'PREPARING', 'PARTIALLY_READY', 'READY', 'SERVED', 'PICKED_UP',
    'COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'NO_SHOW'
  )),
  payment_status text not null default 'UNPAID' check (payment_status in (
    'UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'
  )),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor integer not null default 0 check (subtotal_minor >= 0),
  discount_minor integer not null default 0 check (discount_minor >= 0),
  tax_minor integer not null default 0 check (tax_minor >= 0),
  total_minor integer not null default 0 check (total_minor >= 0),
  customer_name text check (customer_name is null or length(customer_name) <= 160),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 40),
  customer_email text check (customer_email is null or length(customer_email) <= 320),
  notes text check (notes is null or length(notes) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, store_id, order_number),
  foreign key (organization_id, store_id)
    references public.stores(organization_id, id) on delete restrict,
  check (discount_minor <= subtotal_minor),
  check (total_minor = subtotal_minor - discount_minor + tax_minor)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  variant_id uuid,
  menu_item_id uuid,
  sku text not null check (length(trim(sku)) between 1 and 64),
  product_name text not null check (length(trim(product_name)) between 1 and 160),
  product_description text not null default '' check (length(product_description) <= 2000),
  variant_code text,
  variant_name text,
  unit_price_minor integer not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0 and quantity <= 999),
  subtotal_minor integer not null check (subtotal_minor >= 0),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  unique (organization_id, order_id, line_number),
  foreign key (organization_id, order_id)
    references public.orders(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, variant_id, product_id)
    references public.product_variants(organization_id, id, product_id) on delete restrict,
  foreign key (organization_id, menu_item_id)
    references public.menu_items(organization_id, id) on delete restrict
);

create table if not exists public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_item_id uuid not null,
  modifier_id uuid not null,
  modifier_group_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 160),
  price_delta_minor integer not null,
  quantity integer not null default 1 check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (organization_id, order_item_id)
    references public.order_items(organization_id, id) on delete cascade,
  foreign key (organization_id, modifier_id)
    references public.modifiers(organization_id, id) on delete restrict,
  foreign key (organization_id, modifier_group_id)
    references public.modifier_groups(organization_id, id) on delete restrict
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  method text not null check (method in ('CASH', 'PROMPTPAY', 'EXTERNAL_CARD', 'MANUAL')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  received_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  foreign key (organization_id, store_id)
    references public.stores(organization_id, id) on delete restrict,
  foreign key (organization_id, order_id)
    references public.orders(organization_id, id) on delete cascade
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  payment_id uuid,
  amount_minor integer not null check (amount_minor > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  reason text check (reason is null or length(reason) <= 500),
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, id),
  foreign key (organization_id, store_id)
    references public.stores(organization_id, id) on delete restrict,
  foreign key (organization_id, order_id)
    references public.orders(organization_id, id) on delete cascade,
  foreign key (organization_id, payment_id)
    references public.payments(organization_id, id) on delete set null
);

create unique index if not exists payments_provider_reference_unique_idx
  on public.payments (organization_id, provider_reference)
  where provider_reference is not null;

-- A ready event is a one-time side effect even if a transition request is
-- retried. The transition function also guards the status change itself.
create unique index if not exists domain_events_order_ready_once_idx
  on public.domain_events (aggregate_id, event_type)
  where aggregate_type = 'order' and event_type = 'order.ready';

create index if not exists orders_store_created_idx
  on public.orders (organization_id, store_id, created_at desc);
create index if not exists orders_store_status_created_idx
  on public.orders (organization_id, store_id, status, created_at desc);
create index if not exists orders_org_number_idx
  on public.orders (organization_id, order_number);
create index if not exists order_items_order_line_idx
  on public.order_items (organization_id, order_id, line_number);
create index if not exists payments_order_created_idx
  on public.payments (organization_id, order_id, created_at desc);
create index if not exists refunds_order_created_idx
  on public.refunds (organization_id, order_id, created_at desc);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();
drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();
drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at before update on public.refunds
for each row execute function public.set_updated_at();

create or replace function private.order_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_from
    when 'DRAFT' then p_to in ('PENDING_PAYMENT', 'PAID', 'CANCELLED')
    when 'PENDING_PAYMENT' then p_to in ('PAID', 'CANCELLED')
    when 'PAID' then p_to in ('CONFIRMED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    when 'CONFIRMED' then p_to in ('QUEUED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    when 'QUEUED' then p_to in ('ACCEPTED', 'CANCELLED')
    when 'ACCEPTED' then p_to in ('PREPARING', 'CANCELLED')
    when 'PREPARING' then p_to in ('PARTIALLY_READY', 'READY', 'CANCELLED')
    when 'PARTIALLY_READY' then p_to in ('READY', 'CANCELLED')
    when 'READY' then p_to in ('SERVED', 'PICKED_UP', 'NO_SHOW', 'CANCELLED')
    when 'SERVED' then p_to in ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    when 'PICKED_UP' then p_to in ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    when 'COMPLETED' then p_to in ('PARTIALLY_REFUNDED', 'REFUNDED')
    when 'PARTIALLY_REFUNDED' then p_to = 'REFUNDED'
    when 'NO_SHOW' then p_to = 'CANCELLED'
    else false
  end;
$function$;

create or replace function private.order_event_type(p_status text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_status
    when 'PENDING_PAYMENT' then 'order.payment_pending'
    when 'PAID' then 'order.paid'
    when 'CONFIRMED' then 'order.confirmed'
    when 'QUEUED' then 'order.queued'
    when 'ACCEPTED' then 'order.accepted'
    when 'PREPARING' then 'order.preparing'
    when 'PARTIALLY_READY' then 'order.partially_ready'
    when 'READY' then 'order.ready'
    when 'SERVED' then 'order.served'
    when 'PICKED_UP' then 'order.picked_up'
    when 'COMPLETED' then 'order.completed'
    when 'CANCELLED' then 'order.cancelled'
    when 'REFUNDED' then 'order.refunded'
    when 'PARTIALLY_REFUNDED' then 'order.partially_refunded'
    when 'NO_SHOW' then 'order.no_show'
    else null
  end;
$function$;

-- Create one order, calculate prices from the current catalog, snapshot every
-- item/modifier, and append order.created to the transactional outbox.
create or replace function public.create_order(
  p_organization_id uuid,
  p_store_id uuid,
  p_created_by uuid,
  p_channel text,
  p_fulfillment_type text,
  p_currency text default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns table(order_id uuid, order_number text, status text, idempotent boolean)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_store_timezone text;
  v_store_currency text;
  v_business_date date;
  v_sequence integer;
  v_order_id uuid;
  v_order_number text;
  v_order_status text;
  v_existing_response jsonb;
  v_item jsonb;
  v_modifier_value text;
  v_product_id uuid;
  v_variant_id uuid;
  v_menu_item_id uuid;
  v_modifier_id uuid;
  v_order_item_id uuid;
  v_sku text;
  v_product_name text;
  v_product_description text;
  v_product_currency text;
  v_variant_code text;
  v_variant_name text;
  v_modifier_group_id uuid;
  v_modifier_name text;
  v_modifier_group_name text;
  v_modifier_price integer;
  v_note text;
  v_quantity integer;
  v_line_number integer := 0;
  v_modifier_count integer;
  v_distinct_modifier_count integer;
  v_selected_count integer;
  v_min_selections integer;
  v_max_selections integer;
  v_base_price integer;
  v_unit_price integer;
  v_modifier_total integer;
  v_line_subtotal integer;
  v_subtotal integer := 0;
  v_modifier_ids jsonb;
  v_price_override integer;
  v_menu_product_id uuid;
  v_menu_variant_id uuid;
  v_menu_store_id uuid;
  v_menu_channel text;
  v_menu_status text;
  v_menu_available boolean;
  v_menu_sold_out boolean;
  v_availability_available boolean;
  v_availability_sold_out boolean;
  v_group record;
begin
  if p_channel not in ('POS', 'QR', 'KIOSK', 'PICKUP', 'STAFF', 'API') then
    raise exception using errcode = '22023', message = 'Unsupported order channel';
  end if;
  if p_fulfillment_type not in ('TAKEAWAY', 'DINE_IN', 'PICKUP') then
    raise exception using errcode = '22023', message = 'Unsupported fulfillment type';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception using errcode = '22023', message = 'An order must contain between 1 and 100 items';
  end if;
  if p_customer_name is not null and length(p_customer_name) > 160 then
    raise exception using errcode = '22023', message = 'Customer name is too long';
  end if;
  if p_customer_phone is not null and length(p_customer_phone) > 40 then
    raise exception using errcode = '22023', message = 'Customer phone is too long';
  end if;
  if p_customer_email is not null and length(p_customer_email) > 320 then
    raise exception using errcode = '22023', message = 'Customer email is too long';
  end if;
  if p_notes is not null and length(p_notes) > 2000 then
    raise exception using errcode = '22023', message = 'Order notes are too long';
  end if;

  select s.timezone, s.currency
    into v_store_timezone, v_store_currency
  from public.stores s
  where s.organization_id = p_organization_id
    and s.id = p_store_id
    and s.status = 'ACTIVE';
  if not found then
    raise exception using errcode = '23503', message = 'Store was not found in the organization';
  end if;
  v_store_currency := upper(coalesce(nullif(btrim(p_currency), ''), v_store_currency));
  if v_store_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'Currency must be a three-letter ISO code';
  end if;
  if p_idempotency_key is not null then
    p_idempotency_key := btrim(p_idempotency_key);
    if length(p_idempotency_key) < 8 or length(p_idempotency_key) > 200 then
      raise exception using errcode = '22023', message = 'Idempotency-Key must be between 8 and 200 characters';
    end if;
    insert into public.idempotency_keys (organization_id, user_id, scope, key, expires_at)
    values (p_organization_id, p_created_by, 'order.create', p_idempotency_key, timezone('utc', now()) + interval '1 day')
    on conflict (organization_id, scope, key) do nothing;
    if not found then
      select i.response_body into v_existing_response
      from public.idempotency_keys i
      where i.organization_id = p_organization_id
        and i.scope = 'order.create'
        and i.key = p_idempotency_key
      for update;
      v_order_id := nullif(v_existing_response->>'orderId', '')::uuid;
      if v_order_id is null then
        raise exception using errcode = '40001', message = 'The previous order request is still in progress';
      end if;
      select o.order_number, o.status into v_order_number, v_order_status
      from public.orders o
      where o.organization_id = p_organization_id and o.id = v_order_id;
      if not found then
        raise exception using errcode = '40001', message = 'The idempotent order no longer exists';
      end if;
      return query select v_order_id, v_order_number, v_order_status, true;
      return;
    end if;
  end if;

  v_business_date := (timezone(v_store_timezone, clock_timestamp()))::date;
  insert into public.order_sequences (organization_id, store_id, business_date, next_value)
  values (p_organization_id, p_store_id, v_business_date, 2)
  on conflict (organization_id, store_id, business_date)
  do update set next_value = public.order_sequences.next_value + 1
  returning next_value - 1 into v_sequence;
  v_order_number := 'SO-' || to_char(v_business_date, 'YYYYMMDD') || '-' || lpad(v_sequence::text, 5, '0');
  v_order_id := gen_random_uuid();

  insert into public.orders (
    id, organization_id, store_id, order_number, channel, fulfillment_type,
    currency, customer_name, customer_phone, customer_email, notes, created_by
  ) values (
    v_order_id, p_organization_id, p_store_id, v_order_number, p_channel, p_fulfillment_type,
    v_store_currency, nullif(btrim(p_customer_name), ''), nullif(btrim(p_customer_phone), ''),
    nullif(lower(btrim(p_customer_email)), ''), nullif(btrim(p_notes), ''), p_created_by
  );

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line_number := v_line_number + 1;
    if nullif(v_item->>'productId', '') is null then
      raise exception using errcode = '22023', message = 'Each order item needs a productId';
    end if;
    v_product_id := (v_item->>'productId')::uuid;
    v_variant_id := nullif(v_item->>'variantId', '')::uuid;
    v_menu_item_id := nullif(v_item->>'menuItemId', '')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 999 then
      raise exception using errcode = '22023', message = 'Order item quantity must be between 1 and 999';
    end if;
    v_note := nullif(btrim(v_item->>'note'), '');

    select p.sku, p.name, p.description, p.currency, p.base_price_minor
      into v_sku, v_product_name, v_product_description, v_product_currency, v_base_price
    from public.products p
    where p.organization_id = p_organization_id
      and p.id = v_product_id
      and p.status = 'ACTIVE';
    if not found then
      raise exception using errcode = '23503', message = 'Product was not found or is not active';
    end if;
    if v_product_currency <> v_store_currency then
      raise exception using errcode = '22023', message = 'Product currency does not match the store currency';
    end if;

    select pa.is_available, pa.sold_out
      into v_availability_available, v_availability_sold_out
    from public.product_availability pa
    where pa.organization_id = p_organization_id
      and pa.store_id = p_store_id
      and pa.product_id = v_product_id
      and pa.channel = p_channel;
    if not found or v_availability_available is false or v_availability_sold_out is true then
      raise exception using errcode = '22023', message = 'Product is not available for this store and channel';
    end if;

    v_variant_code := null;
    v_variant_name := null;
    if v_variant_id is not null then
      select pv.code, pv.name, pv.price_minor
        into v_variant_code, v_variant_name, v_unit_price
      from public.product_variants pv
      where pv.organization_id = p_organization_id
        and pv.id = v_variant_id
        and pv.product_id = v_product_id
        and pv.status = 'ACTIVE';
      if not found then
        raise exception using errcode = '23503', message = 'Variant was not found on the selected product';
      end if;
    else
      v_unit_price := v_base_price;
    end if;

    if v_menu_item_id is not null then
      select mi.price_override_minor, mi.product_id, mi.variant_id,
             m.store_id, m.channel, m.status, mi.is_available, mi.sold_out
        into v_price_override, v_menu_product_id, v_menu_variant_id,
             v_menu_store_id, v_menu_channel, v_menu_status, v_menu_available, v_menu_sold_out
      from public.menu_items mi
      join public.menus m on m.organization_id = mi.organization_id and m.id = mi.menu_id
      where mi.organization_id = p_organization_id and mi.id = v_menu_item_id;
      if not found or v_menu_store_id <> p_store_id or v_menu_channel <> p_channel
         or v_menu_status <> 'ACTIVE' or v_menu_available is false or v_menu_sold_out is true
         or v_menu_product_id <> v_product_id
         or v_menu_variant_id is distinct from v_variant_id then
        raise exception using errcode = '22023', message = 'Menu item is not available for this order';
      end if;
      if v_price_override is not null then v_unit_price := v_price_override; end if;
    end if;

    v_modifier_ids := coalesce(v_item->'modifierIds', '[]'::jsonb);
    if jsonb_typeof(v_modifier_ids) <> 'array' or jsonb_array_length(v_modifier_ids) > 50 then
      raise exception using errcode = '22023', message = 'Modifier selection is invalid';
    end if;
    select count(*) into v_modifier_count from jsonb_array_elements_text(v_modifier_ids);
    select count(distinct value::uuid) into v_distinct_modifier_count from jsonb_array_elements_text(v_modifier_ids);
    if v_modifier_count <> v_distinct_modifier_count then
      raise exception using errcode = '22023', message = 'A modifier cannot be selected more than once';
    end if;

    if v_menu_item_id is not null then
      for v_group in
        select mg.id, mg.min_selections, mg.max_selections
        from public.menu_item_modifier_groups mig
        join public.modifier_groups mg
          on mg.organization_id = mig.organization_id and mg.id = mig.modifier_group_id
        where mig.organization_id = p_organization_id
          and mig.menu_item_id = v_menu_item_id
          and mg.status = 'ACTIVE'
      loop
        select count(*) into v_selected_count
        from jsonb_array_elements_text(v_modifier_ids) selected(value)
        join public.modifiers modifier
          on modifier.organization_id = p_organization_id
         and modifier.id = selected.value::uuid
         and modifier.modifier_group_id = v_group.id
         and modifier.status = 'ACTIVE';
        if v_selected_count < v_group.min_selections or v_selected_count > v_group.max_selections then
          raise exception using errcode = '22023', message = 'Modifier selection count is invalid for this item';
        end if;
      end loop;
    end if;

    v_modifier_total := 0;
    v_order_item_id := gen_random_uuid();
    -- First validate and price modifiers. Their immutable snapshots are
    -- inserted after the parent line exists so the FK remains valid.
    for v_modifier_value in select value from jsonb_array_elements_text(v_modifier_ids) loop
      v_modifier_id := v_modifier_value::uuid;
      select m.modifier_group_id, m.name, m.price_delta_minor, mg.name
        into v_modifier_group_id, v_modifier_name, v_modifier_price, v_modifier_group_name
      from public.modifiers m
      join public.modifier_groups mg
        on mg.organization_id = m.organization_id and mg.id = m.modifier_group_id
      where m.organization_id = p_organization_id
        and m.id = v_modifier_id
        and m.status = 'ACTIVE'
        and mg.status = 'ACTIVE';
      if not found then
        raise exception using errcode = '23503', message = 'Modifier was not found or is not active';
      end if;
      if v_menu_item_id is not null and not exists (
        select 1 from public.menu_item_modifier_groups mig
        where mig.organization_id = p_organization_id
          and mig.menu_item_id = v_menu_item_id
          and mig.modifier_group_id = v_modifier_group_id
      ) then
        raise exception using errcode = '22023', message = 'Modifier is not configured for this menu item';
      end if;
      v_modifier_total := v_modifier_total + v_modifier_price;
    end loop;
    -- The modifier loop reuses v_unit_price for its snapshot value. Re-read the
    -- product/variant/menu price before calculating the line total.
    if v_variant_id is not null then
      select pv.price_minor into v_base_price
      from public.product_variants pv
      where pv.organization_id = p_organization_id and pv.id = v_variant_id;
    else
      select p.base_price_minor into v_base_price
      from public.products p
      where p.organization_id = p_organization_id and p.id = v_product_id;
    end if;
    if v_menu_item_id is not null and v_price_override is not null then v_base_price := v_price_override; end if;
    v_unit_price := v_base_price + v_modifier_total;
    if v_unit_price < 0 then
      raise exception using errcode = '22023', message = 'Order item price cannot be negative';
    end if;
    v_line_subtotal := v_unit_price * v_quantity;
    insert into public.order_items (
      id, organization_id, order_id, line_number, product_id, variant_id, menu_item_id,
      sku, product_name, product_description, variant_code, variant_name,
      unit_price_minor, quantity, subtotal_minor, note
    ) values (
      v_order_item_id, p_organization_id, v_order_id, v_line_number, v_product_id, v_variant_id, v_menu_item_id,
      v_sku, v_product_name, v_product_description, v_variant_code, v_variant_name,
      v_unit_price, v_quantity, v_line_subtotal, v_note
    );
    for v_modifier_value in select value from jsonb_array_elements_text(v_modifier_ids) loop
      v_modifier_id := v_modifier_value::uuid;
      select m.modifier_group_id, m.name, m.price_delta_minor
        into v_modifier_group_id, v_modifier_name, v_modifier_price
      from public.modifiers m
      join public.modifier_groups mg
        on mg.organization_id = m.organization_id and mg.id = m.modifier_group_id
      where m.organization_id = p_organization_id
        and m.id = v_modifier_id
        and m.status = 'ACTIVE'
        and mg.status = 'ACTIVE';
      insert into public.order_item_modifiers (
        organization_id, order_item_id, modifier_id, modifier_group_id,
        name, price_delta_minor, quantity
      ) values (
        p_organization_id, v_order_item_id, v_modifier_id, v_modifier_group_id,
        v_modifier_name, v_modifier_price, 1
      );
    end loop;
    v_subtotal := v_subtotal + v_line_subtotal;
  end loop;

  update public.orders
  set subtotal_minor = v_subtotal, total_minor = v_subtotal, version = version + 1
  where organization_id = p_organization_id and id = v_order_id;

  insert into public.domain_events (organization_id, event_type, aggregate_type, aggregate_id, payload, metadata)
  values (
    p_organization_id, 'order.created', 'order', v_order_id,
    jsonb_build_object('orderId', v_order_id, 'orderNumber', v_order_number, 'storeId', p_store_id, 'channel', p_channel),
    jsonb_build_object('createdBy', p_created_by, 'source', 'order_engine')
  );
  insert into public.outbox_events (domain_event_id, organization_id)
  select de.id, de.organization_id
  from public.domain_events de
  where de.aggregate_id = v_order_id and de.event_type = 'order.created'
  order by de.created_at desc limit 1;

  if p_idempotency_key is not null then
    update public.idempotency_keys
    set resource_id = v_order_id,
        response_status = 201,
        response_body = jsonb_build_object('orderId', v_order_id, 'orderNumber', v_order_number)
    where organization_id = p_organization_id and scope = 'order.create' and key = p_idempotency_key;
  end if;
  return query select v_order_id, v_order_number, 'DRAFT'::text, false;
end;
$function$;

-- Transition an order with an optimistic expected status and an atomic event
-- plus outbox write.  Omitting expected status still locks and validates the
-- current status, while passing it makes stale clients fail safely.
create or replace function public.transition_order(
  p_organization_id uuid,
  p_store_id uuid,
  p_order_id uuid,
  p_actor_id uuid,
  p_to_status text,
  p_expected_status text default null,
  p_reason text default null,
  p_idempotency_key text default null
)
returns table(order_id uuid, order_number text, status text, payment_status text, idempotent boolean)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_order_number text;
  v_current_status text;
  v_payment_status text;
  v_event_type text;
  v_existing_response jsonb;
  v_scope text := 'order.transition:' || p_order_id::text;
begin
  if p_to_status not in (
    'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'QUEUED', 'ACCEPTED', 'PREPARING',
    'PARTIALLY_READY', 'READY', 'SERVED', 'PICKED_UP', 'COMPLETED',
    'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'NO_SHOW'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported order status';
  end if;
  if p_reason is not null and length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'Transition reason is too long';
  end if;
  if p_idempotency_key is not null then
    p_idempotency_key := btrim(p_idempotency_key);
    if length(p_idempotency_key) < 8 or length(p_idempotency_key) > 200 then
      raise exception using errcode = '22023', message = 'Idempotency-Key must be between 8 and 200 characters';
    end if;
    insert into public.idempotency_keys (organization_id, user_id, scope, key, expires_at)
    values (p_organization_id, p_actor_id, v_scope, p_idempotency_key, timezone('utc', now()) + interval '1 day')
    on conflict (organization_id, scope, key) do nothing;
    if not found then
      select i.response_body into v_existing_response
      from public.idempotency_keys i
      where i.organization_id = p_organization_id and i.scope = v_scope and i.key = p_idempotency_key
      for update;
      if v_existing_response->>'orderId' is null then
        raise exception using errcode = '40001', message = 'The previous transition request is still in progress';
      end if;
      return query
        select o.id, o.order_number, o.status, o.payment_status, true
        from public.orders o
        where o.organization_id = p_organization_id and o.id = p_order_id;
      return;
    end if;
  end if;

  select o.order_number, o.status, o.payment_status
    into v_order_number, v_current_status, v_payment_status
  from public.orders o
  where o.organization_id = p_organization_id and o.store_id = p_store_id and o.id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found in the selected store';
  end if;
  if p_expected_status is not null and p_expected_status <> v_current_status then
    raise exception using errcode = '40001', message = 'Order status changed; refresh before retrying';
  end if;
  if not private.order_transition_allowed(v_current_status, p_to_status) then
    raise exception using errcode = '22023', message = format('Order cannot transition from %s to %s', v_current_status, p_to_status);
  end if;
  v_event_type := private.order_event_type(p_to_status);
  if v_event_type is null then
    raise exception using errcode = '22023', message = 'Order transition does not have a domain event';
  end if;
  update public.orders
  set status = p_to_status,
      payment_status = case
        when p_to_status = 'PAID' then 'PAID'
        when p_to_status = 'REFUNDED' then 'REFUNDED'
        when p_to_status = 'PARTIALLY_REFUNDED' then 'PARTIALLY_REFUNDED'
        else payment_status
      end,
      version = version + 1
  where organization_id = p_organization_id and id = p_order_id;
  insert into public.domain_events (organization_id, event_type, aggregate_type, aggregate_id, payload, metadata)
  values (
    p_organization_id, v_event_type, 'order', p_order_id,
    jsonb_build_object('orderId', p_order_id, 'orderNumber', v_order_number, 'fromStatus', v_current_status, 'toStatus', p_to_status),
    jsonb_build_object('actorId', p_actor_id, 'reason', p_reason, 'source', 'order_engine')
  );
  insert into public.outbox_events (domain_event_id, organization_id)
  select de.id, de.organization_id
  from public.domain_events de
  where de.aggregate_id = p_order_id and de.event_type = v_event_type
  order by de.created_at desc limit 1;
  if p_idempotency_key is not null then
    update public.idempotency_keys
    set resource_id = p_order_id,
        response_status = 200,
        response_body = jsonb_build_object('orderId', p_order_id, 'status', p_to_status)
    where organization_id = p_organization_id and scope = v_scope and key = p_idempotency_key;
  end if;
  return query select p_order_id, v_order_number, p_to_status, case
    when p_to_status = 'PAID' then 'PAID'
    when p_to_status = 'REFUNDED' then 'REFUNDED'
    when p_to_status = 'PARTIALLY_REFUNDED' then 'PARTIALLY_REFUNDED'
    else v_payment_status end, false;
end;
$function$;

-- Record a paid payment and move DRAFT/PENDING_PAYMENT orders to PAID in one
-- transaction. Payment gateway adapters can call this command after verifying
-- their own webhook/signature.
create or replace function public.record_order_payment(
  p_organization_id uuid,
  p_store_id uuid,
  p_order_id uuid,
  p_received_by uuid,
  p_method text,
  p_amount_minor integer,
  p_currency text default null,
  p_provider_reference text default null,
  p_idempotency_key text default null
)
returns table(order_id uuid, payment_id uuid, order_status text, payment_status text, idempotent boolean)
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_order_status text;
  v_payment_status text;
  v_order_currency text;
  v_order_total integer;
  v_paid_total integer;
  v_payment_id uuid;
  v_existing_response jsonb;
  v_scope text := 'payment.create:' || p_order_id::text;
begin
  if p_method not in ('CASH', 'PROMPTPAY', 'EXTERNAL_CARD', 'MANUAL') then
    raise exception using errcode = '22023', message = 'Unsupported payment method';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'Payment amount must be positive';
  end if;
  if p_idempotency_key is not null then
    p_idempotency_key := btrim(p_idempotency_key);
    if length(p_idempotency_key) < 8 or length(p_idempotency_key) > 200 then
      raise exception using errcode = '22023', message = 'Idempotency-Key must be between 8 and 200 characters';
    end if;
    insert into public.idempotency_keys (organization_id, user_id, scope, key, expires_at)
    values (p_organization_id, p_received_by, v_scope, p_idempotency_key, timezone('utc', now()) + interval '1 day')
    on conflict (organization_id, scope, key) do nothing;
    if not found then
      select i.response_body into v_existing_response
      from public.idempotency_keys i
      where i.organization_id = p_organization_id and i.scope = v_scope and i.key = p_idempotency_key
      for update;
      if v_existing_response->>'paymentId' is null then
        raise exception using errcode = '40001', message = 'The previous payment request is still in progress';
      end if;
      return query
        select p_order_id, (v_existing_response->>'paymentId')::uuid,
               (v_existing_response->>'orderStatus'), 'PAID'::text, true;
      return;
    end if;
  end if;

  select o.status, o.payment_status, o.currency, o.total_minor
    into v_order_status, v_payment_status, v_order_currency, v_order_total
  from public.orders o
  where o.organization_id = p_organization_id and o.store_id = p_store_id and o.id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found in the selected store';
  end if;
  if v_order_status in ('CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'COMPLETED', 'NO_SHOW') then
    raise exception using errcode = '22023', message = 'Payment cannot be recorded for this order status';
  end if;
  if coalesce(nullif(upper(btrim(p_currency)), ''), v_order_currency) <> v_order_currency then
    raise exception using errcode = '22023', message = 'Payment currency does not match the order currency';
  end if;
  select coalesce(sum(pay.amount_minor), 0) into v_paid_total
  from public.payments pay
  where pay.organization_id = p_organization_id and pay.order_id = p_order_id and pay.status = 'PAID';
  if p_amount_minor <> v_order_total - v_paid_total then
    raise exception using errcode = '22023', message = 'Payment amount must equal the remaining order total';
  end if;
  v_payment_id := gen_random_uuid();
  insert into public.payments (
    id, organization_id, store_id, order_id, method, status, amount_minor,
    currency, provider_reference, received_by
  ) values (
    v_payment_id, p_organization_id, p_store_id, p_order_id, p_method, 'PAID',
    p_amount_minor, v_order_currency, nullif(btrim(p_provider_reference), ''), p_received_by
  );
  if v_order_status in ('DRAFT', 'PENDING_PAYMENT') then
    update public.orders set status = 'PAID', payment_status = 'PAID', version = version + 1
    where organization_id = p_organization_id and id = p_order_id;
    insert into public.domain_events (organization_id, event_type, aggregate_type, aggregate_id, payload, metadata)
    values (
      p_organization_id, 'order.paid', 'order', p_order_id,
      jsonb_build_object('orderId', p_order_id, 'paymentId', v_payment_id, 'amountMinor', p_amount_minor),
      jsonb_build_object('actorId', p_received_by, 'source', 'payment_service')
    );
    insert into public.outbox_events (domain_event_id, organization_id)
    select de.id, de.organization_id from public.domain_events de
    where de.aggregate_id = p_order_id and de.event_type = 'order.paid'
    order by de.created_at desc limit 1;
    v_order_status := 'PAID';
  end if;
  if p_idempotency_key is not null then
    update public.idempotency_keys
    set resource_id = v_payment_id,
        response_status = 201,
        response_body = jsonb_build_object('paymentId', v_payment_id, 'orderStatus', v_order_status)
    where organization_id = p_organization_id and scope = v_scope and key = p_idempotency_key;
  end if;
  return query select p_order_id, v_payment_id, v_order_status, 'PAID'::text, false;
end;
$function$;

-- These functions are server-only. RLS remains enabled on every order table,
-- and only the Worker’s service role may execute the atomic commands.
revoke all on function private.order_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function private.order_event_type(text) from public, anon, authenticated;
revoke all on function public.create_order(uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.transition_order(uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_order_payment(uuid, uuid, uuid, uuid, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, text) to service_role;
grant execute on function public.transition_order(uuid, uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.record_order_payment(uuid, uuid, uuid, uuid, text, integer, text, text, text) to service_role;

grant select, insert, update, delete on
  public.order_sequences, public.orders, public.order_items,
  public.order_item_modifiers, public.payments, public.refunds
to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'order_sequences', 'orders', 'order_items', 'order_item_modifiers', 'payments', 'refunds'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;
