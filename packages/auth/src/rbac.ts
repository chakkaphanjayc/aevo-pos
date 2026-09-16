import type { Permission, SessionPrincipal } from "@aevo/contracts";

export function hasPermission(principal: SessionPrincipal, permission: Permission): boolean {
  return principal.permissions.includes(permission);
}

export function requirePermission(principal: SessionPrincipal, permission: Permission): void {
  if (!hasPermission(principal, permission)) throw new AuthorizationError(permission);
}

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  constructor(readonly permission: Permission) {
    super(`Permission required: ${permission}`);
    this.name = "AuthorizationError";
  }
}
