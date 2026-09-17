-- Phase 4: Tables for QR self-ordering and dine-in context
CREATE TABLE IF NOT EXISTS public.tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  table_number text NOT NULL CHECK (length(trim(table_number)) BETWEEN 1 AND 32),
  label text CHECK (label IS NULL OR length(trim(label)) BETWEEN 1 AND 64),
  qr_code_url text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, store_id, table_number),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tables_store_idx
  ON public.tables (organization_id, store_id, status);

ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_tables"
  ON public.tables FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_store_manage_tables"
  ON public.tables FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));
