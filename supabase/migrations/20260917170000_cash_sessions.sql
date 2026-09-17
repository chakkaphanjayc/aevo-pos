-- Phase 10.4: Cash Drawer Sessions
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  opened_by uuid NOT NULL,
  closed_by uuid,
  opening_amount_minor integer NOT NULL DEFAULT 0,
  closing_amount_minor integer,
  expected_amount_minor integer,
  cash_difference_minor integer,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  closed_at timestamptz,
  notes text,
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_cash_sessions"
  ON public.cash_sessions FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_cash_sessions"
  ON public.cash_sessions FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));
