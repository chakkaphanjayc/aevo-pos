-- Align table operations with the staff table board. The original tables
-- migration used ACTIVE/INACTIVE while the board tracks occupancy states.
ALTER TABLE public.tables
  DROP CONSTRAINT IF EXISTS tables_status_check;

UPDATE public.tables
SET status = CASE status
  WHEN 'ACTIVE' THEN 'AVAILABLE'
  WHEN 'INACTIVE' THEN 'UNAVAILABLE'
  ELSE status
END
WHERE status IN ('ACTIVE', 'INACTIVE');

ALTER TABLE public.tables
  ADD CONSTRAINT tables_status_check
  CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'UNAVAILABLE'));

CREATE INDEX IF NOT EXISTS tables_store_status_idx
  ON public.tables (organization_id, store_id, status, table_number);

CREATE INDEX IF NOT EXISTS floors_store_order_idx
  ON public.floors (organization_id, store_id, display_order);
