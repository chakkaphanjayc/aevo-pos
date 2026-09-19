-- Phase 6: Kitchen Display System (KDS) & Preparation Stations
CREATE TABLE IF NOT EXISTS public.preparation_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  code text NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 32),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, store_id, code),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.station_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  station_id uuid NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('PRODUCT', 'CATEGORY', 'ALL')),
  match_id uuid, -- product_id or category_id, NULL for ALL
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, station_id)
    REFERENCES public.preparation_stations(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.preparation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  station_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, order_id)
    REFERENCES public.orders(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, order_item_id)
    REFERENCES public.order_items(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, station_id)
    REFERENCES public.preparation_stations(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS prep_tasks_station_status_idx
  ON public.preparation_tasks (organization_id, store_id, station_id, status, created_at);

CREATE INDEX IF NOT EXISTS prep_tasks_order_idx
  ON public.preparation_tasks (organization_id, order_id);

ALTER TABLE public.preparation_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preparation_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_stations"
  ON public.preparation_stations FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_stations"
  ON public.preparation_stations FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

CREATE POLICY "org_member_read_routing_rules"
  ON public.station_routing_rules FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_routing_rules"
  ON public.station_routing_rules FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

CREATE POLICY "org_member_read_prep_tasks"
  ON public.preparation_tasks FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_prep_tasks"
  ON public.preparation_tasks FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));
