-- Public customer tracking uses opaque, high-entropy tokens instead of
-- exposing internal order UUIDs or staff-facing identifiers.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS public_tracking_token text
    NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS orders_public_tracking_token_idx
  ON public.orders (public_tracking_token);

COMMENT ON COLUMN public.orders.public_tracking_token IS
  'Opaque customer-facing token for order tracking and electronic receipt links';
