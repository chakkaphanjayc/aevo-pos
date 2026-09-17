-- Phase 9: Scheduled Pickup and Prep Timing
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS scheduled_pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepare_at timestamptz;

CREATE TABLE IF NOT EXISTS public.store_prep_durations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  default_minutes integer NOT NULL DEFAULT 15,
  PRIMARY KEY (organization_id, store_id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE public.queue_configs
  ADD COLUMN IF NOT EXISTS no_show_timeout_minutes integer DEFAULT 30;

ALTER TABLE public.store_prep_durations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_store_prep"
  ON public.store_prep_durations FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_store_prep"
  ON public.store_prep_durations FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));
