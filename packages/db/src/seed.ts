import { createClient } from "@supabase/supabase-js";
import type { Permission, Role } from "@aevo/contracts";
import { permissions, roles } from "@aevo/contracts";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "organization";
}

function assertNoError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

function displayRole(role: Role): string {
  return role === "BRANCH_MANAGER" ? "Branch manager" : role[0] + role.slice(1).toLowerCase();
}

/**
 * Create/update the first staff account and its tenant. This command must run
 * outside the Worker with a Supabase secret key; it is intentionally not an
 * HTTP endpoint.
 */
export async function seed(
  supabaseUrl: string,
  supabaseKey: string,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  const email = env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const password = env.SEED_OWNER_PASSWORD;
  if (!email || !password || password.length < 12 || password === "change-me-now") {
    throw new Error("Set SEED_OWNER_EMAIL and a unique 12+ character SEED_OWNER_PASSWORD before seeding");
  }
  const organizationName = env.SEED_ORGANIZATION_NAME?.trim() || "Aevo Demo";
  const storeName = env.SEED_STORE_NAME?.trim() || "Main Store";
  const timezone = env.SEED_STORE_TIMEZONE?.trim() || "Asia/Bangkok";
  const requestedInitialRole = (env.SEED_INITIAL_ROLE ?? "OWNER").trim().toUpperCase();
  if (!roles.includes(requestedInitialRole as Role)) throw new Error("SEED_INITIAL_ROLE must be one of the supported roles");
  const initialRole = requestedInitialRole as Role;

  const client = createClient(supabaseUrl.replace(/\/$/, ""), supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const usersResult = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  assertNoError(usersResult.error, "user lookup");
  let authUser = usersResult.data.users.find((user) => user.email?.toLowerCase() === email);
  if (authUser) {
    const updated = await client.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true
    });
    assertNoError(updated.error, "user update");
    authUser = updated.data.user ?? authUser;
  } else {
    const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
    assertNoError(created.error, "user creation");
    if (!created.data.user) throw new Error("Supabase did not return the created user");
    authUser = created.data.user;
  }

  const profileResult = await client.from("user_profiles").upsert({
    id: authUser.id,
    email,
    display_name: email.split("@")[0] || "Owner",
    status: "ACTIVE"
  }, { onConflict: "id" }).select("id").single();
  assertNoError(profileResult.error, "profile seed");

  const organizationResult = await client.from("organizations").upsert({
    name: organizationName,
    slug: slugify(organizationName),
    status: "ACTIVE"
  }, { onConflict: "slug" }).select("id").single();
  assertNoError(organizationResult.error, "organization seed");
  const organizationId = (organizationResult.data as { id: string }).id;

  const storeResult = await client.from("stores").upsert({
    organization_id: organizationId,
    code: "MAIN",
    name: storeName,
    timezone,
    currency: "THB",
    status: "ACTIVE"
  }, { onConflict: "organization_id,code" }).select("id").single();
  assertNoError(storeResult.error, "store seed");
  const storeId = (storeResult.data as { id: string }).id;

  const roleResult = await client.from("roles").select("id").eq("code", initialRole).single();
  assertNoError(roleResult.error, "role lookup");
  if (!roleResult.data) throw new Error(`Role ${initialRole} is missing; apply Supabase migrations first`);
  const roleId = (roleResult.data as { id: string }).id;

  const membershipResult = await client.from("memberships").upsert({
    organization_id: organizationId,
    user_id: authUser.id,
    role_id: roleId,
    status: "ACTIVE"
  }, { onConflict: "organization_id,user_id" }).select("id").single();
  assertNoError(membershipResult.error, "membership seed");
  const membershipId = (membershipResult.data as { id: string }).id;

  const accessResult = await client.from("membership_stores").upsert({
    membership_id: membershipId,
    store_id: storeId
  }, { onConflict: "membership_id,store_id" });
  assertNoError(accessResult.error, "store access seed");

  // The migration owns the canonical role/permission matrix. This assertion
  // catches an incomplete migration before a staff member tries to log in.
  const permissionsResult = await client.from("permissions").select("code");
  assertNoError(permissionsResult.error, "permission verification");
  const availablePermissions = new Set((permissionsResult.data ?? []).map((row) => (row as { code: string }).code));
  const missing = permissions.filter((permission: Permission) => !availablePermissions.has(permission));
  if (missing.length) throw new Error(`Supabase migration is missing permissions: ${missing.join(", ")}`);

  console.info(JSON.stringify({
    level: "info",
    event: "seed.completed",
    ownerEmail: email,
    role: initialRole,
    organizationId,
    storeId,
    displayRole: displayRole(initialRole)
  }));
}

if (import.meta.main) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  await seed(supabaseUrl, supabaseKey);
}
