-- Aevo Hub & Ecosystem Subscriptions Migration
-- Creates the app registry, subscription tracking, and entitlement checks for modular business apps.

CREATE TABLE IF NOT EXISTS public.apps (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL,
  icon text NOT NULL,
  pricing_model text NOT NULL DEFAULT 'PER_BRANCH' CHECK (pricing_model IN ('PER_BRANCH', 'PER_DEVICE', 'PER_VENUE', 'PER_ORG', 'BUNDLE', 'FREE')),
  base_price_monthly_minor integer NOT NULL DEFAULT 0 CHECK (base_price_monthly_minor >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BETA', 'COMING_SOON', 'DEPRECATED')),
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.app_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  app_id text NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'TRIAL' CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
  plan_code text NOT NULL DEFAULT 'STANDARD',
  trial_ends_at timestamptz DEFAULT (timezone('utc', now()) + interval '14 days'),
  current_period_starts_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  current_period_ends_at timestamptz NOT NULL DEFAULT (timezone('utc', now()) + interval '14 days'),
  grace_period_ends_at timestamptz DEFAULT (timezone('utc', now()) + interval '28 days'),
  device_limit integer CHECK (device_limit IS NULL OR device_limit > 0),
  resource_limit integer CHECK (resource_limit IS NULL OR resource_limit > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, store_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_app_subs_org_store ON public.app_subscriptions (organization_id, store_id, app_id);

ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_subscriptions ENABLE ROW LEVEL SECURITY;

-- Apps catalog is readable by any authenticated user or system service
CREATE POLICY "apps_read_policy"
  ON public.apps FOR SELECT
  USING (true);

-- Subscriptions are readable by members of the organization
CREATE POLICY "org_member_read_subscriptions"
  ON public.app_subscriptions FOR SELECT
  USING (private.is_org_member(organization_id));

-- Subscriptions can be managed by organization managers / admins
CREATE POLICY "org_manage_subscriptions"
  ON public.app_subscriptions FOR ALL
  USING (private.has_org_permission(organization_id, 'organization.manage'));

-- Entitlement check helper function
CREATE OR REPLACE FUNCTION private.is_app_entitled(
  target_org_id uuid,
  target_store_id uuid,
  target_app_id text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  sub_record record;
BEGIN
  -- Look for store-specific subscription first, then org-wide subscription (store_id IS NULL)
  SELECT status, current_period_ends_at, grace_period_ends_at, trial_ends_at
  INTO sub_record
  FROM public.app_subscriptions
  WHERE organization_id = target_org_id
    AND app_id = target_app_id
    AND (store_id = target_store_id OR store_id IS NULL)
  ORDER BY (store_id IS NOT NULL) DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Active subscriptions are valid
  IF sub_record.status = 'ACTIVE' AND sub_record.current_period_ends_at >= timezone('utc', now()) THEN
    RETURN true;
  END IF;

  -- Trials are valid if not expired
  IF sub_record.status = 'TRIAL' AND sub_record.trial_ends_at >= timezone('utc', now()) THEN
    RETURN true;
  END IF;

  -- Grace period allows read/access for a short duration after expiration
  IF sub_record.grace_period_ends_at IS NOT NULL AND sub_record.grace_period_ends_at >= timezone('utc', now()) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Seed core ecosystem apps
INSERT INTO public.apps (id, name, description, icon, pricing_model, base_price_monthly_minor, status, features)
VALUES
  (
    'pos',
    'Aevo POS',
    'ระบบจุดขายหน้าร้าน คิดเงิน จัดการผังโต๊ะ รับออเดอร์ ออกใบเสร็จ เปิด/ปิดกะแคชเชียร์ และส่งงานเข้าครัว (KDS)',
    'pos',
    'PER_BRANCH',
    49900,
    'ACTIVE',
    '["แคชเชียร์และเปิด/ปิดกะ", "ผังโต๊ะและจัดการโซน", "ออกใบเสร็จความร้อน 58/80mm", "ส่งงานเข้า KDS และเรียกคิว", "สรุปยอดขายประจำวัน"]'::jsonb
  ),
  (
    'kiosk',
    'Aevo Kiosk',
    'ระบบสั่งอาหารและบริการด้วยตนเองผ่านจอสัมผัส และระบบ QR สั่งอาหารที่โต๊ะ เชื่อมตรงเข้า POS และครัว',
    'kiosk',
    'PER_DEVICE',
    29900,
    'ACTIVE',
    '["Self-order บนแท็บเล็ต/Kiosk", "QR Code สั่งอาหารที่โต๊ะ", "รองรับ PromptPay Dynamic QR", "จับคู่อุปกรณ์ด้วย Device Token", "ส่งตรงเข้าคิวและครัว"]'::jsonb
  ),
  (
    'booking',
    'Aevo Booking',
    'ระบบจองสนามกีฬา ห้องประชุม สตูดิโอ โต๊ะอาหาร และทรัพยากร พร้อมตารางเวลา Real-time และระบบแจ้งเตือนผ่าน LINE',
    'booking',
    'PER_VENUE',
    59900,
    'ACTIVE',
    '["ตารางเวลา Real-time ตรวจสอบความว่าง", "ราคา Peak / Off-peak ตามช่วงเวลา", "รับชำระมัดจำหรือเต็มจำนวน", "Check-in ด้วย QR Code", "LINE Official Account แจ้งเตือนอัตโนมัติ"]'::jsonb
  ),
  (
    'crm',
    'Aevo CRM & Loyalty',
    'ระบบบริหารความสัมพันธ์ลูกค้า สมาชิก สะสมแต้ม ประวัติการใช้บริการ และการบรอดแคสต์โปรโมชั่นผ่าน LINE OA',
    'crm',
    'PER_ORG',
    39900,
    'COMING_SOON',
    '["ฐานข้อมูลสมาชิกลูกค้า", "ระบบคะแนนสะสมและระดับสมาชิก", "คูปองและโปรโมชั่นเฉพาะบุคคล", "เชื่อมต่อ LINE Official Account"]'::jsonb
  ),
  (
    'inventory',
    'Aevo Inventory & Production',
    'ระบบบริหารคลังสินค้าขั้นสูง ตัดสูตรการผลิต (BOM) สต๊อกวัตถุดิบ จุดสั่งซื้อซ้ำ และเชื่อมต่อ ERP/Odoo',
    'inventory',
    'PER_ORG',
    49900,
    'COMING_SOON',
    '["ควบคุมสต๊อกวัตถุดิบแบบละเอียด", "ผูกสูตรอาหาร (Bill of Materials)", "แจ้งเตือนจุดสั่งซื้อซ้ำ (Reorder Point)", "เชื่อมต่อสต๊อก Odoo 19"]'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  pricing_model = EXCLUDED.pricing_model,
  base_price_monthly_minor = EXCLUDED.base_price_monthly_minor,
  status = EXCLUDED.status,
  features = EXCLUDED.features;

-- Backfill 14-day trial subscriptions for existing stores so existing workflows remain operational
INSERT INTO public.app_subscriptions (
  organization_id,
  store_id,
  app_id,
  status,
  plan_code,
  trial_ends_at,
  current_period_starts_at,
  current_period_ends_at,
  grace_period_ends_at
)
SELECT
  s.organization_id,
  s.id AS store_id,
  a.id AS app_id,
  'ACTIVE' AS status,
  'STANDARD' AS plan_code,
  timezone('utc', now()) + interval '365 days',
  timezone('utc', now()),
  timezone('utc', now()) + interval '365 days',
  timezone('utc', now()) + interval '395 days'
FROM public.stores s
CROSS JOIN (
  SELECT id FROM public.apps WHERE id IN ('pos', 'kiosk', 'booking')
) a
ON CONFLICT (organization_id, store_id, app_id) DO NOTHING;
