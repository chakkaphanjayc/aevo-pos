-- Aevo Booking Domain Migration
-- Multi-tenant venue, bookable resource, operating hours, pricing rules, and bookings.

CREATE TABLE IF NOT EXISTS public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  description text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  slot_duration_minutes integer NOT NULL DEFAULT 60 CHECK (slot_duration_minutes BETWEEN 15 AND 240),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS public.bookable_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  resource_type text NOT NULL DEFAULT 'COURT' CHECK (resource_type IN ('COURT', 'ROOM', 'STUDIO', 'TABLE', 'EQUIPMENT')),
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  base_price_minor integer NOT NULL DEFAULT 0 CHECK (base_price_minor >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time text NOT NULL CHECK (open_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  close_time text NOT NULL CHECK (close_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (venue_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS public.special_operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  date date NOT NULL,
  open_time text CHECK (open_time IS NULL OR open_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  close_time text CHECK (close_time IS NULL OR close_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  closed boolean NOT NULL DEFAULT false,
  reason text,
  UNIQUE (venue_id, date)
);

CREATE TABLE IF NOT EXISTS public.booking_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES public.bookable_resources(id) ON DELETE CASCADE,
  day_of_week integer CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  start_time text NOT NULL CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time text NOT NULL CHECK (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  priority integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.resource_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.bookable_resources(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (start_at < end_at)
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.bookable_resources(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_name text NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 160),
  customer_phone text,
  customer_email text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  amount_minor integer NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  checkin_code text,
  checked_in_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (start_at < end_at)
);

CREATE INDEX IF NOT EXISTS idx_bookings_venue_dates ON public.bookings (venue_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_resource_dates ON public.bookings (resource_id, start_at, end_at);

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookable_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "org_member_read_venues"
  ON public.venues FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_venues"
  ON public.venues FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

CREATE POLICY "org_member_read_resources"
  ON public.bookable_resources FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_resources"
  ON public.bookable_resources FOR ALL
  USING (private.has_org_permission(organization_id, 'catalog.manage'));

CREATE POLICY "org_member_read_operating_hours"
  ON public.operating_hours FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_operating_hours"
  ON public.operating_hours FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

CREATE POLICY "org_member_read_special_hours"
  ON public.special_operating_hours FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_special_hours"
  ON public.special_operating_hours FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

CREATE POLICY "org_member_read_pricing_rules"
  ON public.booking_pricing_rules FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_pricing_rules"
  ON public.booking_pricing_rules FOR ALL
  USING (private.has_org_permission(organization_id, 'catalog.manage'));

CREATE POLICY "org_member_read_resource_blocks"
  ON public.resource_blocks FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_resource_blocks"
  ON public.resource_blocks FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));

CREATE POLICY "org_member_read_bookings"
  ON public.bookings FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_bookings"
  ON public.bookings FOR ALL
  USING (private.has_org_permission(organization_id, 'order.create'));
