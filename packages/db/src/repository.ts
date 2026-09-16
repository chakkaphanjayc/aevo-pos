import type { Permission, Role, SessionPrincipal, StoreSummary } from "@aevo/contracts";
import type { Database } from "./client";

export interface UserRecord { id: string; email: string; displayName: string; passwordHash: string }
interface StoreRow { id: string; organization_id: string; name: string; code: string; timezone: string }

export async function findActiveUserByEmail(sql: Database, email: string): Promise<UserRecord | null> {
  const rows = await sql`SELECT id, email, display_name, password_hash FROM users
    WHERE lower(email) = lower(${email}) AND status = 'ACTIVE' LIMIT 1`;
  const row = rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name, passwordHash: row.password_hash } : null;
}

export async function createSession(
  sql: Database,
  input: { userId: string; tokenHash: string; expiresAt: Date; ipAddress?: string; userAgent?: string }
): Promise<void> {
  await sql`INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
    VALUES (${input.userId}, ${input.tokenHash}, ${input.expiresAt}, ${input.ipAddress ?? null}, ${input.userAgent ?? null})`;
}

export async function revokeSession(sql: Database, tokenHash: string): Promise<void> {
  await sql`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`;
}

export async function resolvePrincipal(
  sql: Database,
  tokenHash: string,
  requestedOrganizationId?: string
): Promise<SessionPrincipal | null> {
  const rows = await sql`SELECT u.id AS user_id, u.email, m.id AS membership_id,
      m.organization_id, r.code AS role,
      COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.status = 'ACTIVE'
    JOIN memberships m ON m.user_id = u.id AND m.status = 'ACTIVE'
    JOIN roles r ON r.id = m.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND s.expires_at > now()
      AND (${requestedOrganizationId ?? null}::uuid IS NULL OR m.organization_id = ${requestedOrganizationId ?? null}::uuid)
    GROUP BY u.id, u.email, m.id, m.organization_id, r.code
    ORDER BY m.created_at ASC LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    membershipId: row.membership_id,
    organizationId: row.organization_id,
    role: row.role as Role,
    permissions: row.permissions as Permission[]
  };
}

export async function listAuthorizedStores(sql: Database, principal: SessionPrincipal): Promise<StoreSummary[]> {
  const rows = await sql`SELECT s.id, s.organization_id, s.name, s.code, s.timezone
    FROM stores s
    WHERE s.organization_id = ${principal.organizationId} AND s.status = 'ACTIVE'
      AND (${principal.role} IN ('OWNER', 'ADMIN') OR EXISTS (
        SELECT 1 FROM membership_store_access msa
        WHERE msa.organization_id = ${principal.organizationId}
          AND msa.membership_id = ${principal.membershipId} AND msa.store_id = s.id
      ))
    ORDER BY s.name`;
  return rows.map((row: StoreRow) => ({
    id: row.id, organizationId: row.organization_id, name: row.name, code: row.code, timezone: row.timezone
  }));
}

export async function canAccessStore(sql: Database, principal: SessionPrincipal, storeId: string): Promise<boolean> {
  const rows = await sql`SELECT EXISTS (
    SELECT 1 FROM stores s WHERE s.id = ${storeId} AND s.organization_id = ${principal.organizationId}
      AND s.status = 'ACTIVE' AND (${principal.role} IN ('OWNER', 'ADMIN') OR EXISTS (
        SELECT 1 FROM membership_store_access msa
        WHERE msa.organization_id = ${principal.organizationId}
          AND msa.membership_id = ${principal.membershipId} AND msa.store_id = s.id
      ))
  ) AS allowed`;
  return rows[0]?.allowed === true;
}
