export const roles = [
  "OWNER", "ADMIN", "BRANCH_MANAGER", "CASHIER", "KITCHEN", "STAFF", "VIEWER"
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  "organization.manage", "store.read", "store.manage", "member.manage",
  "catalog.read", "catalog.manage", "order.read", "order.create",
  "payment.receive", "refund.create", "order.void", "price.override",
  "cash_drawer.open", "integration.manage", "audit.read"
] as const;

export type Permission = (typeof permissions)[number];

export interface SessionPrincipal {
  userId: string;
  email: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  permissions: Permission[];
}

export interface StoreSummary {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  timezone: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}
