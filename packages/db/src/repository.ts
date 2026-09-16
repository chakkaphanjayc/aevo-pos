import type { Permission, Role, SessionPrincipal, StoreSummary } from "@aevo/contracts";
import { permissions as permissionCodes, roles as roleCodes } from "@aevo/contracts";
import type { Database } from "./client";

interface UserProfileRow {
  id: string;
  email: string;
  display_name: string;
  status: "ACTIVE" | "DISABLED";
}

interface MembershipRow {
  id: string;
  organization_id: string;
  role_id: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  created_at: string;
}

interface RoleRow {
  id: string;
  code: string;
}

interface StoreRow {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  timezone: string;
  status: "ACTIVE" | "INACTIVE";
}

function throwIfError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

function isRole(value: string): value is Role {
  return roleCodes.includes(value as Role);
}

function isPermission(value: string): value is Permission {
  return permissionCodes.includes(value as Permission);
}

/**
 * Resolve an authenticated Supabase user into the app's tenant-scoped
 * principal. Membership and role data are always read from our tables rather
 * than from JWT metadata, so revoking a membership takes effect immediately.
 */
export async function resolvePrincipal(
  database: Database,
  userId: string,
  requestedOrganizationId?: string
): Promise<SessionPrincipal | null> {
  const profileResult = await database.client
    .from("user_profiles")
    .select("id,email,display_name,status")
    .eq("id", userId)
    .maybeSingle();
  throwIfError(profileResult.error, "user profile lookup");
  const profile = profileResult.data as UserProfileRow | null;
  if (!profile || profile.status !== "ACTIVE") return null;

  let membershipQuery = database.client
    .from("memberships")
    .select("id,organization_id,role_id,status,created_at")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: true })
    .limit(1);
  if (requestedOrganizationId) membershipQuery = membershipQuery.eq("organization_id", requestedOrganizationId);
  const membershipResult = await membershipQuery;
  throwIfError(membershipResult.error, "membership lookup");
  const membership = (membershipResult.data?.[0] ?? null) as MembershipRow | null;
  if (!membership) return null;

  const organizationResult = await database.client
    .from("organizations")
    .select("id,status")
    .eq("id", membership.organization_id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  throwIfError(organizationResult.error, "organization lookup");
  if (!organizationResult.data) return null;

  const roleResult = await database.client
    .from("roles")
    .select("id,code")
    .eq("id", membership.role_id)
    .maybeSingle();
  throwIfError(roleResult.error, "role lookup");
  const role = roleResult.data as RoleRow | null;
  if (!role || !isRole(role.code)) return null;

  const permissionResult = await database.client
    .from("role_permissions")
    .select("permission_code")
    .eq("role_id", role.id);
  throwIfError(permissionResult.error, "permission lookup");
  const resolvedPermissions = (permissionResult.data ?? [])
    .map((row) => (row as { permission_code: string }).permission_code)
    .filter(isPermission);

  return {
    userId: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    membershipId: membership.id,
    organizationId: membership.organization_id,
    role: role.code,
    permissions: resolvedPermissions
  };
}

export async function listAuthorizedStores(database: Database, principal: SessionPrincipal): Promise<StoreSummary[]> {
  let allowedStoreIds: string[] | undefined;
  if (principal.role !== "OWNER" && principal.role !== "ADMIN") {
    const accessResult = await database.client
      .from("membership_stores")
      .select("store_id")
      .eq("membership_id", principal.membershipId);
    throwIfError(accessResult.error, "store access lookup");
    allowedStoreIds = (accessResult.data ?? []).map((row) => (row as { store_id: string }).store_id);
    if (allowedStoreIds.length === 0) return [];
  }

  let storeQuery = database.client
    .from("stores")
    .select("id,organization_id,name,code,timezone,status")
    .eq("organization_id", principal.organizationId)
    .eq("status", "ACTIVE")
    .order("name", { ascending: true });
  if (allowedStoreIds) storeQuery = storeQuery.in("id", allowedStoreIds);
  const storesResult = await storeQuery;
  throwIfError(storesResult.error, "store lookup");
  return ((storesResult.data ?? []) as StoreRow[]).map((store) => ({
    id: store.id,
    organizationId: store.organization_id,
    name: store.name,
    code: store.code,
    timezone: store.timezone
  }));
}

export async function canAccessStore(database: Database, principal: SessionPrincipal, storeId: string): Promise<boolean> {
  const storeResult = await database.client
    .from("stores")
    .select("id,organization_id,status")
    .eq("id", storeId)
    .eq("organization_id", principal.organizationId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  throwIfError(storeResult.error, "store access check");
  if (!storeResult.data) return false;
  if (principal.role === "OWNER" || principal.role === "ADMIN") return true;

  const membershipStoreResult = await database.client
    .from("membership_stores")
    .select("membership_id")
    .eq("membership_id", principal.membershipId)
    .eq("store_id", storeId)
    .maybeSingle();
  throwIfError(membershipStoreResult.error, "membership store access check");
  return Boolean(membershipStoreResult.data);
}
