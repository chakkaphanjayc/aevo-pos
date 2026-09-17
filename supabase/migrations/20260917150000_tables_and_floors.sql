-- Phase 10.1: Floors and Tables Floor Plan
CREATE TABLE IF NOT EXISTS public.floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  display_order integer NOT NULL DEFAULT 0,
  width integer NOT NULL DEFAULT 800,
  height integer NOT NULL DEFAULT 600,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS floor_id uuid REFERENCES public.floors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position_x integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position_y integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shape text DEFAULT 'RECTANGLE' CHECK (shape IN ('RECTANGLE', 'CIRCLE', 'CUSTOM')),
  ADD COLUMN IF NOT EXISTS seats integer DEFAULT 4,
  ADD COLUMN IF NOT EXISTS current_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_floors"
  ON public.floors FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_floors"
  ON public.floors FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));
