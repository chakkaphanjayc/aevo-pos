-- Backfill permissions introduced after the original foundation migration.
-- This is intentionally separate from the devices migration so projects that
-- already applied it can repair existing system-role memberships safely.
INSERT INTO public.permissions (code, description)
VALUES ('devices.manage', 'Register, pair and revoke store devices')
ON CONFLICT (code) DO UPDATE SET description = excluded.description;

INSERT INTO public.role_permissions (role_id, permission_code)
SELECT r.id, 'devices.manage'
FROM public.roles r
WHERE r.code IN ('OWNER', 'ADMIN', 'BRANCH_MANAGER')
ON CONFLICT DO NOTHING;
