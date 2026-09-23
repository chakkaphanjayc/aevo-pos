import type { AppAccessDecision, ApplicationCode, Role, SessionPrincipal } from "@aevo/contracts";
import { roles } from "@aevo/contracts";
import type { Database } from "./client";
import { canAccessStore } from "./repository";
import { throwDatabaseError } from "./errors";

interface AssignmentRow {
  id: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  starts_at: string;
  expires_at: string | null;
}

function isRole(value: string): value is Role {
  return roles.includes(value as Role);
}

function denied(application: ApplicationCode, reason: AppAccessDecision["reason"], checkedAt: string, userId: string): AppAccessDecision {
  return { allowed: false, application, reason, permissions: [], checkedAt, userId };
}

function allowed(application: ApplicationCode, principal: SessionPrincipal, checkedAt: string, storeId?: string): AppAccessDecision {
  return {
    allowed: true,
    application,
    reason: "ALLOWED",
    userId: principal.userId,
    organizationId: principal.organizationId,
    ...(storeId ? { storeId } : {}),
    role: principal.role,
    permissions: [...principal.permissions],
    checkedAt
  };
}

function isCurrentAssignment(row: AssignmentRow, now: number): boolean {
  const startsAt = Date.parse(row.starts_at);
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
  return row.status === "ACTIVE" && Number.isFinite(startsAt) && startsAt <= now && expiresAt > now;
}

/** Resolve POS app assignment, role and store scope on the trusted API. */
export async function resolveApplicationAccess(
  database: Database,
  input: { principal: SessionPrincipal; application: ApplicationCode; storeId?: string }
): Promise<AppAccessDecision> {
  const checkedAt = new Date().toISOString();
  const { principal } = input;
  const assignmentResult = await database.client
    .from("member_app_assignments")
    .select("id,status,starts_at,expires_at")
    .eq("membership_id", principal.membershipId)
    .eq("application_code", input.application)
    .order("created_at", { ascending: false });
  throwDatabaseError(assignmentResult.error, "application assignment lookup");
  const assignment = ((assignmentResult.data ?? []) as AssignmentRow[])[0];
  if (!assignment) return denied(input.application, "APP_ASSIGNMENT_REQUIRED", checkedAt, principal.userId);
  if (assignment.status === "SUSPENDED") return denied(input.application, "APP_ASSIGNMENT_SUSPENDED", checkedAt, principal.userId);
  if (!isCurrentAssignment(assignment, Date.now())) return denied(input.application, "APP_ASSIGNMENT_REQUIRED", checkedAt, principal.userId);

  const [scopeResult, roleResult] = await Promise.all([
    database.client.from("member_app_scopes").select("scope_type,scope_ref").eq("assignment_id", assignment.id),
    database.client.from("member_app_roles").select("role_id").eq("assignment_id", assignment.id)
  ]);
  throwDatabaseError(scopeResult.error, "application scope lookup");
  throwDatabaseError(roleResult.error, "application role lookup");

  const scopes = (scopeResult.data ?? []) as Array<{ scope_type?: string; scope_ref?: string }>;
  if (input.storeId && !await canAccessStore(database, principal, input.storeId)) {
    return denied(input.application, "SCOPE_REQUIRED", checkedAt, principal.userId);
  }
  if (scopes.length > 0) {
    const organizationScope = scopes.some((scope) => scope.scope_type === "ORGANIZATION" && scope.scope_ref === principal.organizationId);
    const storeScope = input.storeId ? scopes.some((scope) => scope.scope_type === "STORE" && scope.scope_ref === input.storeId) : false;
    const hasAnyStoreScope = scopes.some((scope) => scope.scope_type === "STORE");
    if (input.storeId ? !organizationScope && !storeScope : !organizationScope && !hasAnyStoreScope) {
      return denied(input.application, "SCOPE_REQUIRED", checkedAt, principal.userId);
    }
  }

  const roleIds = (roleResult.data ?? [])
    .map((row) => (row as { role_id?: unknown }).role_id)
    .filter((value): value is string => typeof value === "string");
  if (roleIds.length > 0) {
    const assignedRolesResult = await database.client.from("roles").select("code").in("id", roleIds);
    throwDatabaseError(assignedRolesResult.error, "application role resolution");
    const assignedRoles = (assignedRolesResult.data ?? [])
      .map((row) => (row as { code?: unknown }).code)
      .filter((value): value is string => typeof value === "string" && isRole(value));
    if (!assignedRoles.includes(principal.role)) return denied(input.application, "PERMISSION_REQUIRED", checkedAt, principal.userId);
  }

  return allowed(input.application, principal, checkedAt, input.storeId);
}
