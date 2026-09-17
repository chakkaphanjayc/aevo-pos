import { roles, type AuditLogSummary, type MemberSummary, type Role, type SessionPrincipal } from "@aevo/contracts";
import type { Database } from "./client";

type Row = Record<string, unknown>;

function isRole(value: string): value is Role { return roles.includes(value as Role); }

export async function listMembers(database: Database, principal: SessionPrincipal): Promise<MemberSummary[]> {
  const membershipsResult = await database.client
    .from("memberships")
    .select("id,user_id,role_id,status,created_at")
    .eq("organization_id", principal.organizationId)
    .order("created_at", { ascending: true });
  if (membershipsResult.error || !membershipsResult.data) return [];
  const memberships = membershipsResult.data as Row[];
  const userIds = memberships.map((row) => String(row.user_id));
  const roleIds = memberships.map((row) => String(row.role_id));
  const [profilesResult, rolesResult, accessResult] = await Promise.all([
    userIds.length ? database.client.from("user_profiles").select("id,email,display_name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    roleIds.length ? database.client.from("roles").select("id,code").in("id", roleIds) : Promise.resolve({ data: [], error: null }),
    memberships.length ? database.client.from("membership_stores").select("membership_id,store_id").in("membership_id", memberships.map((row) => String(row.id))) : Promise.resolve({ data: [], error: null })
  ]);
  const profiles = new Map((profilesResult.data ?? []).map((row) => [String((row as Row).id), row as Row]));
  const roleMap = new Map((rolesResult.data ?? []).map((row) => [String((row as Row).id), String((row as Row).code)]));
  const stores = new Map<string, string[]>();
  for (const row of (accessResult.data ?? []) as Row[]) {
    const values = stores.get(String(row.membership_id)) ?? [];
    values.push(String(row.store_id));
    stores.set(String(row.membership_id), values);
  }
  return memberships.flatMap((row) => {
    const role = roleMap.get(String(row.role_id));
    const profile = profiles.get(String(row.user_id));
    if (!role || !isRole(role) || !profile) return [];
    return [{
      membershipId: String(row.id), userId: String(row.user_id), email: String(profile.email),
      displayName: String(profile.display_name ?? ""), role,
      status: (row.status === "INVITED" || row.status === "SUSPENDED" ? row.status : "ACTIVE") as MemberSummary["status"],
      storeIds: stores.get(String(row.id)) ?? [], createdAt: String(row.created_at)
    }];
  });
}

export async function updateMember(
  database: Database,
  principal: SessionPrincipal,
  membershipId: string,
  input: { role: Role; status?: "ACTIVE" | "SUSPENDED"; storeIds: string[] }
): Promise<MemberSummary | null> {
  const roleResult = await database.client.from("roles").select("id").eq("code", input.role).maybeSingle();
  if (roleResult.error || !roleResult.data) throw new Error("Role not found");
  const accessResult = await database.client.from("stores").select("id").eq("organization_id", principal.organizationId).in("id", input.storeIds);
  if (accessResult.error) throw new Error(`Store access lookup failed: ${accessResult.error.message}`);
  const allowedStoreIds = new Set((accessResult.data ?? []).map((row) => String((row as Row).id)));
  const storeIds = input.storeIds.filter((id) => allowedStoreIds.has(id));
  const updated = await database.client.from("memberships").update({ role_id: String((roleResult.data as Row).id), ...(input.status ? { status: input.status } : {}) }).eq("organization_id", principal.organizationId).eq("id", membershipId).select("id").maybeSingle();
  if (updated.error || !updated.data) return null;
  const deleted = await database.client.from("membership_stores").delete().eq("membership_id", membershipId);
  if (deleted.error) throw new Error(`Store access update failed: ${deleted.error.message}`);
  if (storeIds.length) {
    const inserted = await database.client.from("membership_stores").insert(storeIds.map((storeId) => ({ membership_id: membershipId, store_id: storeId })));
    if (inserted.error) throw new Error(`Store access update failed: ${inserted.error.message}`);
  }
  return (await listMembers(database, principal)).find((member) => member.membershipId === membershipId) ?? null;
}

export async function listAuditLogs(database: Database, principal: SessionPrincipal, limit = 100): Promise<AuditLogSummary[]> {
  const result = await database.client.from("audit_logs").select("id,organization_id,user_id,action,resource_type,resource_id,metadata,created_at").eq("organization_id", principal.organizationId).order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 200));
  if (result.error || !result.data) return [];
  return (result.data as Row[]).map((row) => ({
    id: String(row.id), organizationId: String(row.organization_id),
    ...(row.user_id ? { userId: String(row.user_id) } : {}), action: String(row.action), resourceType: String(row.resource_type),
    ...(row.resource_id ? { resourceId: String(row.resource_id) } : {}), metadata: (row.metadata as Record<string, unknown>) ?? {}, createdAt: String(row.created_at)
  }));
}

export async function writeAuditLog(database: Database, input: { organizationId: string; userId?: string; action: string; resourceType: string; resourceId?: string; metadata?: Record<string, unknown> }): Promise<void> {
  await database.client.from("audit_logs").insert({ organization_id: input.organizationId, user_id: input.userId || null, action: input.action, resource_type: input.resourceType, resource_id: input.resourceId || null, metadata: input.metadata ?? {} });
}
