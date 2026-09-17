-- Phase 10.2 & 10.3: Reservations, Waitlist, Inventory Items and Movements
CREATE TABLE IF NOT EXISTS public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  table_id uuid REFERENCES public.tables(id) ON DELETE SET NULL,
  customer_name text NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 160),
  customer_phone text,
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size > 0),
  reserved_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','SEATED','COMPLETED','NO_SHOW','CANCELLED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  customer_name text NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 160),
  customer_phone text,
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size > 0),
  position integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','NOTIFIED','SEATED','LEFT')),
  estimated_wait_minutes integer,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  product_id uuid,
  sku text NOT NULL CHECK (length(trim(sku)) BETWEEN 1 AND 64),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  unit text NOT NULL DEFAULT 'PCS',
  quantity_on_hand numeric(12,4) NOT NULL DEFAULT 0,
  reorder_point numeric(12,4) DEFAULT 0,
  cost_per_unit_minor integer DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, store_id, sku),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('IN','OUT','ADJUSTMENT','SALE','WASTE')),
  quantity numeric(12,4) NOT NULL,
  reference_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_reservations"
  ON public.reservations FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_reservations"
  ON public.reservations FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));

CREATE POLICY "org_member_read_waitlist"
  ON public.waitlist FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_waitlist"
  ON public.waitlist FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));

CREATE POLICY "org_member_read_inventory"
  ON public.inventory_items FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_inventory"
  ON public.inventory_items FOR ALL
  USING (private.has_org_permission(organization_id, 'catalog.manage'));

CREATE POLICY "org_member_read_movements"
  ON public.inventory_movements FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_movements"
  ON public.inventory_movements FOR ALL
  USING (private.has_org_permission(organization_id, 'catalog.manage'));
