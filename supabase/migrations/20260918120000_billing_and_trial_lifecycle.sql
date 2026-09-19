-- Phase 2: Billing & 14-Day Trial Lifecycle State Machine

-- 1. Extend app_subscriptions status to support granular trial state machine
ALTER TABLE public.app_subscriptions
  DROP CONSTRAINT IF EXISTS app_subscriptions_status_check;

ALTER TABLE public.app_subscriptions
  ADD CONSTRAINT app_subscriptions_status_check
  CHECK (status IN (
    'TRIAL', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'EXPIRED', 'CANCELLED', 'CANCELED', 'READ_ONLY'
  ));

ALTER TABLE public.app_subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_source text DEFAULT 'SELF_SERVE' CHECK (trial_source IN ('SELF_SERVE', 'ADMIN_GRANTED', 'DEMO', 'SALES_INVITE'));

-- 2. Billing Customers (Mapped to Provider Customer IDs)
CREATE TABLE IF NOT EXISTS public.billing_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('STRIPE', 'OPN', 'XENDIT', 'MANUAL')),
  provider_customer_id text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, provider)
);

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_billing_customers"
  ON public.billing_customers FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid()
    )
  );

-- 3. Billing Webhook Events (Idempotency and Audit)
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('STRIPE', 'OPN', 'XENDIT', 'MANUAL')),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_provider_type 
  ON public.billing_webhook_events (provider, event_type);
