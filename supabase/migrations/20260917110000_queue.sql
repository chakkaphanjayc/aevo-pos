-- Phase 5: Queue system for customer-facing order tracking
CREATE TABLE IF NOT EXISTS public.queue_configs (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  prefix text NOT NULL DEFAULT 'Q' CHECK (length(trim(prefix)) BETWEEN 1 AND 5),
  reset_daily boolean NOT NULL DEFAULT true,
  display_mode text NOT NULL DEFAULT 'NUMBER' CHECK (display_mode IN ('NUMBER', 'LETTER_NUMBER')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (organization_id, store_id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.queue_sequences (
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  next_value integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, store_id, business_date),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.queue_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  queue_number text NOT NULL CHECK (length(trim(queue_number)) BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','PREPARING','READY','COMPLETED','CANCELLED')),
  called_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, order_id)
    REFERENCES public.orders(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS queue_tickets_store_status_idx
  ON public.queue_tickets (organization_id, store_id, status, created_at);

CREATE INDEX IF NOT EXISTS queue_tickets_order_idx
  ON public.queue_tickets (organization_id, order_id);

-- Queue numbers reset by business day. PostgreSQL does not allow an
-- expression such as created_at::date inside a table UNIQUE constraint, so
-- enforce the daily uniqueness rule with a unique expression index instead.
CREATE UNIQUE INDEX IF NOT EXISTS queue_tickets_daily_number_unique_idx
  ON public.queue_tickets (organization_id, store_id, queue_number, ((created_at AT TIME ZONE 'UTC')::date));

ALTER TABLE public.queue_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_tickets ENABLE ROW LEVEL SECURITY;

-- Config RLS
CREATE POLICY "org_member_read_queue_configs"
  ON public.queue_configs FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_queue_configs"
  ON public.queue_configs FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

-- Tickets RLS
CREATE POLICY "org_member_read_queue_tickets"
  ON public.queue_tickets FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_queue_tickets"
  ON public.queue_tickets FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'))
  WITH CHECK (private.has_org_permission(organization_id, 'order.create'));
