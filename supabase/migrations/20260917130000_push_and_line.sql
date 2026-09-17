-- Phase 8: Web Push Subscriptions and LINE Official Account Integration
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid,
  user_id uuid,
  device_token text,
  web_push_subscription jsonb,
  platform text NOT NULL CHECK (platform IN ('WEB', 'IOS', 'ANDROID')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.line_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid,
  channel_id text NOT NULL,
  channel_secret text NOT NULL,
  channel_access_token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, store_id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_push_subs"
  ON public.push_subscriptions FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_manage_push_subs"
  ON public.push_subscriptions FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));

CREATE POLICY "org_manage_line_integrations"
  ON public.line_integrations FOR ALL
  USING (private.has_org_permission(organization_id, 'store.manage'));
