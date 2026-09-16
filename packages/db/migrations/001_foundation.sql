CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id uuid NULL,
  name text NOT NULL,
  code text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  currency char(3) NOT NULL DEFAULT 'THB',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands(organization_id, id)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email),
  CHECK (email = lower(email))
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT true
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  UNIQUE (organization_id, id)
);

CREATE TABLE membership_store_access (
  organization_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  store_id uuid NOT NULL,
  PRIMARY KEY (membership_id, store_id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  ip_address inet NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id uuid NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY REFERENCES domain_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  processed_at timestamptz NULL,
  last_error text NULL
);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer NULL,
  response_body jsonb NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, scope, key)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id uuid NULL,
  actor_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  request_id text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id)
);

CREATE INDEX sessions_active_token_idx ON sessions (token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX memberships_user_idx ON memberships (user_id, organization_id) WHERE status = 'ACTIVE';
CREATE INDEX stores_organization_idx ON stores (organization_id, status);
CREATE INDEX domain_events_aggregate_idx ON domain_events (organization_id, aggregate_type, aggregate_id, occurred_at);
CREATE INDEX outbox_pending_idx ON outbox_events (status, available_at) WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX audit_logs_tenant_time_idx ON audit_logs (organization_id, occurred_at DESC);

INSERT INTO roles (code, name) VALUES
  ('OWNER', 'Owner'), ('ADMIN', 'Administrator'), ('BRANCH_MANAGER', 'Branch manager'),
  ('CASHIER', 'Cashier'), ('KITCHEN', 'Kitchen'), ('STAFF', 'Staff'), ('VIEWER', 'Viewer')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
  ('organization.manage', 'Manage organization settings'), ('store.read', 'View authorized stores'),
  ('store.manage', 'Manage stores'), ('member.manage', 'Manage members'),
  ('catalog.read', 'View catalog'), ('catalog.manage', 'Manage catalog'),
  ('order.read', 'View orders'), ('order.create', 'Create orders'),
  ('payment.receive', 'Receive payments'), ('refund.create', 'Create refunds'),
  ('order.void', 'Void orders'), ('price.override', 'Override prices'),
  ('cash_drawer.open', 'Open cash drawer'), ('integration.manage', 'Manage integrations'),
  ('audit.read', 'View audit logs')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('store.read', 'catalog.read', 'catalog.manage', 'order.read', 'order.create', 'payment.receive',
   'refund.create', 'order.void', 'price.override', 'cash_drawer.open', 'audit.read')
WHERE r.code = 'BRANCH_MANAGER' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('store.read', 'catalog.read', 'order.read', 'order.create', 'payment.receive')
WHERE r.code = 'CASHIER' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('store.read', 'order.read')
WHERE r.code IN ('KITCHEN', 'VIEWER') ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('store.read', 'catalog.read', 'order.read', 'order.create')
WHERE r.code = 'STAFF' ON CONFLICT DO NOTHING;
