-- Store Core Hardening Migration
-- Receipts, Cash Movements, Sales Ledger, Daily Closings, and Integration Jobs

-- 1. Product enhancements
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- 2. Receipts Domain Table
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  order_number text NOT NULL,
  store_snapshot jsonb NOT NULL,
  items_snapshot jsonb NOT NULL,
  subtotal_minor integer NOT NULL,
  discount_minor integer NOT NULL DEFAULT 0,
  tax_minor integer NOT NULL DEFAULT 0,
  total_minor integer NOT NULL,
  payments_summary jsonb NOT NULL,
  cash_received_minor integer,
  change_minor integer,
  cashier_name text,
  reprint_count integer NOT NULL DEFAULT 0,
  last_reprinted_at timestamptz,
  is_void boolean NOT NULL DEFAULT false,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_receipts_store ON public.receipts (organization_id, store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_order ON public.receipts (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_org_receipt_number ON public.receipts (organization_id, receipt_number);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_receipts"
  ON public.receipts FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_receipts"
  ON public.receipts FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));

-- 3. Cash Movements (Cash In/Out, Paid In/Out)
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'PAID_IN', 'PAID_OUT')),
  amount_minor integer NOT NULL,
  reason text NOT NULL,
  performed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON public.cash_movements (cash_session_id, created_at ASC);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_cash_movements"
  ON public.cash_movements FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_cash_movements"
  ON public.cash_movements FOR ALL
  USING (private.has_org_permission(organization_id, 'cash_drawer.open'));

-- 4. Basic Sales Ledger
CREATE TABLE IF NOT EXISTS public.sales_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('SALE', 'DISCOUNT', 'TAX', 'REFUND', 'VOID')),
  payment_method text,
  amount_minor integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sales_ledger_store_date ON public.sales_ledger_entries (organization_id, store_id, created_at DESC);

ALTER TABLE public.sales_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_sales_ledger"
  ON public.sales_ledger_entries FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_sales_ledger"
  ON public.sales_ledger_entries FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));

-- 5. Daily Closing Reports
CREATE TABLE IF NOT EXISTS public.daily_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  closing_date date NOT NULL,
  gross_sales_minor integer NOT NULL DEFAULT 0,
  net_sales_minor integer NOT NULL DEFAULT 0,
  discounts_minor integer NOT NULL DEFAULT 0,
  tax_minor integer NOT NULL DEFAULT 0,
  cash_sales_minor integer NOT NULL DEFAULT 0,
  promptpay_sales_minor integer NOT NULL DEFAULT 0,
  card_sales_minor integer NOT NULL DEFAULT 0,
  refunds_minor integer NOT NULL DEFAULT 0,
  voids_minor integer NOT NULL DEFAULT 0,
  total_orders integer NOT NULL DEFAULT 0,
  closed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, store_id, closing_date),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_daily_closings"
  ON public.daily_closings FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_daily_closings"
  ON public.daily_closings FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

-- 6. Integration Jobs (Odoo / External Outbox Jobs)
CREATE TABLE IF NOT EXISTS public.integration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  target_system text NOT NULL DEFAULT 'ODOO',
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integration_jobs_pending ON public.integration_jobs (target_system, status, next_retry_at);

ALTER TABLE public.integration_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_integration_jobs"
  ON public.integration_jobs FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_integration_jobs"
  ON public.integration_jobs FOR ALL
  USING (private.has_org_permission(organization_id, 'integration.manage'));
