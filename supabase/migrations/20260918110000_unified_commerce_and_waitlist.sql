-- Phase 3 & 4: Unified Commerce (order_type) and Booking Waitlists

-- 1. Add order_type to orders table
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'POS' 
  CHECK (order_type IN ('POS', 'KIOSK', 'QR_ORDER', 'BOOKING', 'SERVICE'));

-- Backfill existing orders based on their channel
UPDATE public.orders 
SET order_type = CASE 
  WHEN channel = 'KIOSK' THEN 'KIOSK' 
  WHEN channel = 'QR' THEN 'QR_ORDER' 
  ELSE 'POS' 
END
WHERE order_type = 'POS';

CREATE INDEX IF NOT EXISTS idx_orders_org_order_type 
  ON public.orders (organization_id, order_type);

CREATE INDEX IF NOT EXISTS idx_orders_store_order_type 
  ON public.orders (store_id, order_type);

-- 2. Decouple Waitlists into Booking Domain
CREATE TABLE IF NOT EXISTS public.booking_waitlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES public.bookable_resources(id) ON DELETE SET NULL,
  customer_name text NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 160),
  customer_phone text,
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size > 0),
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'NOTIFIED', 'SEATED', 'CANCELLED', 'EXPIRED')),
  position integer NOT NULL DEFAULT 1,
  estimated_wait_minutes integer,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_booking_waitlists_venue 
  ON public.booking_waitlists (venue_id, status);

ALTER TABLE public.booking_waitlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_booking_waitlists"
  ON public.booking_waitlists FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_manage_booking_waitlists"
  ON public.booking_waitlists FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid()
    )
  );
