import type {
  CreateOrganizationInput,
  CreateStoreInput,
  OrganizationSummary,
  Role,
  StoreSummary
} from "@aevo/contracts";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "org";
}

export async function listUserOrganizations(
  database: Database,
  userId: string
): Promise<OrganizationSummary[]> {
  // Query active memberships for this user
  const membershipsResult = await database.client
    .from("memberships")
    .select("id, organization_id, role_id, status, created_at")
    .eq("user_id", userId)
    .eq("status", "ACTIVE");

  if (membershipsResult.error) {
    throwDatabaseError(membershipsResult.error, "list user organizations");
  }

  const memberships = (membershipsResult.data ?? []) as Row[];
  if (memberships.length === 0) return [];

  const orgIds = memberships.map((m) => String(m.organization_id));
  const roleIds = memberships.map((m) => String(m.role_id));

  const [orgsResult, rolesResult] = await Promise.all([
    database.client
      .from("organizations")
      .select("id, name, slug, status, created_at")
      .in("id", orgIds),
    database.client.from("roles").select("id, code").in("id", roleIds)
  ]);

  if (orgsResult.error) throwDatabaseError(orgsResult.error, "lookup organizations");
  if (rolesResult.error) throwDatabaseError(rolesResult.error, "lookup roles");

  const rolesMap = new Map((rolesResult.data ?? []).map((r: Row) => [String(r.id), String(r.code) as Role]));
  const orgMap = new Map((orgsResult.data ?? []).map((o: Row) => [String(o.id), o]));

  return memberships.flatMap((m) => {
    const org = orgMap.get(String(m.organization_id));
    if (!org) return [];
    return [{
      id: String(org.id),
      name: String(org.name),
      slug: String(org.slug),
      role: rolesMap.get(String(m.role_id)),
      status: (String(org.status) === "ACTIVE" ? "ACTIVE" : "INACTIVE") as OrganizationSummary["status"],
      createdAt: String(org.created_at)
    }];
  });
}

export async function createOrganization(
  database: Database,
  userId: string,
  input: CreateOrganizationInput
): Promise<OrganizationSummary> {
  const slug = input.slug ? slugify(input.slug) : `${slugify(input.name)}-${Date.now().toString(36)}`;

  // 1. Insert organization
  const orgResult = await database.client
    .from("organizations")
    .insert({
      name: input.name,
      slug,
      status: "ACTIVE"
    })
    .select("id, name, slug, status, created_at")
    .single();

  if (orgResult.error) {
    throwDatabaseError(orgResult.error, "create organization");
  }
  const org = orgResult.data as Row;
  const orgId = String(org.id);

  // 2. Find OWNER role
  const roleResult = await database.client
    .from("roles")
    .select("id")
    .eq("code", "OWNER")
    .single();

  if (roleResult.error || !roleResult.data) {
    throwDatabaseError(roleResult.error, "lookup owner role");
    throw new Error("Owner role not found");
  }
  const ownerRoleId = String(roleResult.data.id);

  // 3. Create membership for creator as OWNER
  const membershipResult = await database.client
    .from("memberships")
    .insert({
      organization_id: orgId,
      user_id: userId,
      role_id: ownerRoleId,
      status: "ACTIVE"
    })
    .select("id")
    .single();

  if (membershipResult.error || !membershipResult.data) {
    throwDatabaseError(membershipResult.error, "create owner membership");
    throw new Error("Failed to create owner membership");
  }
  const membershipId = String(membershipResult.data.id);

  // 4. Create default Main Store
  const storeResult = await database.client
    .from("stores")
    .insert({
      organization_id: orgId,
      code: "MAIN",
      name: "สาขาหลัก (Main Branch)",
      timezone: "Asia/Bangkok",
      currency: "THB",
      status: "ACTIVE"
    })
    .select("id")
    .single();

  if (storeResult.error || !storeResult.data) {
    throwDatabaseError(storeResult.error, "create default store");
    throw new Error("Failed to create default store");
  }
  const storeId = String(storeResult.data.id);

  // 5. Grant store access
  await database.client.from("membership_stores").insert({
    membership_id: membershipId,
    store_id: storeId
  });

  // 6. Automatically start 14-day trial for POS
  const now = new Date();
  const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  await database.client.from("app_subscriptions").insert({
    organization_id: orgId,
    store_id: storeId,
    app_id: "pos",
    status: "TRIAL",
    plan_code: "TRIAL_14D",
    current_period_starts_at: now.toISOString(),
    current_period_ends_at: trialEnds.toISOString(),
    trial_ends_at: trialEnds.toISOString()
  });

  return {
    id: orgId,
    name: String(org.name),
    slug: String(org.slug),
    role: "OWNER",
    status: "ACTIVE",
    createdAt: String(org.created_at)
  };
}

export async function listOrganizationStores(
  database: Database,
  organizationId: string
): Promise<StoreSummary[]> {
  const result = await database.client
    .from("stores")
    .select("id, organization_id, name, code, timezone")
    .eq("organization_id", organizationId)
    .eq("status", "ACTIVE")
    .order("code", { ascending: true });

  if (result.error) throwDatabaseError(result.error, "list stores");

  return (result.data ?? []).map((row: Row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    code: String(row.code),
    timezone: String(row.timezone)
  }));
}

export async function createStore(
  database: Database,
  organizationId: string,
  input: CreateStoreInput
): Promise<StoreSummary> {
  const result = await database.client
    .from("stores")
    .insert({
      organization_id: organizationId,
      name: input.name,
      code: input.code.trim().toUpperCase(),
      timezone: input.timezone || "Asia/Bangkok",
      currency: "THB",
      status: "ACTIVE"
    })
    .select("id, organization_id, name, code, timezone")
    .single();

  if (result.error || !result.data) throwDatabaseError(result.error, "create store");
  const row = result.data as Row;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    code: String(row.code),
    timezone: String(row.timezone)
  };
}

export async function getOrganizationStats(
  database: Database,
  organizationId: string
): Promise<{ totalApps: number; activeApps: number; totalStores: number; totalMembers: number }> {
  const [appsRes, subsRes, storesRes, membersRes] = await Promise.all([
    database.client.from("apps").select("id", { count: "exact", head: true }),
    database.client
      .from("app_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", ["ACTIVE", "TRIAL"]),
    database.client
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "ACTIVE"),
    database.client
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "ACTIVE")
  ]);

  return {
    totalApps: appsRes.count ?? 5,
    activeApps: subsRes.count ?? 0,
    totalStores: storesRes.count ?? 1,
    totalMembers: membersRes.count ?? 1
  };
}
