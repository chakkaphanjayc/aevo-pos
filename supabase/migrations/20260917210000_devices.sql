-- Device registration, pairing and mode lock foundation.
CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  mode text NOT NULL CHECK (mode IN ('POS', 'KIOSK', 'KDS', 'QUEUE_DISPLAY')),
  station_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  device_token_hash text,
  paired_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  FOREIGN KEY (organization_id, store_id) REFERENCES public.stores(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS devices_store_idx ON public.devices (organization_id, store_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS devices_pairing_code_idx ON public.devices (pairing_code_hash) WHERE pairing_code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS devices_token_idx ON public.devices (device_token_hash) WHERE device_token_hash IS NOT NULL;

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member_read_devices" ON public.devices FOR SELECT USING (private.is_org_member(organization_id));
CREATE POLICY "org_manage_devices" ON public.devices FOR ALL USING (private.has_org_permission(organization_id, 'devices.manage'));

DROP TRIGGER IF EXISTS devices_set_updated_at ON public.devices;
CREATE TRIGGER devices_set_updated_at BEFORE UPDATE ON public.devices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.permissions (code, description)
VALUES ('devices.manage', 'Register, pair and revoke store devices')
ON CONFLICT (code) DO UPDATE SET description = excluded.description;

INSERT INTO public.role_permissions (role_id, permission_code)
SELECT r.id, 'devices.manage' FROM public.roles r WHERE r.code IN ('OWNER', 'ADMIN', 'BRANCH_MANAGER')
ON CONFLICT DO NOTHING;
