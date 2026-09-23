import type { AppConfig } from "@aevo/config";
import type { Permission, Role, SessionPrincipal } from "@aevo/contracts";
import { AppError } from "./errors";
import { readCookie } from "./http";

interface CoreSessionPayload {
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

export interface CoreResolvedSession {
  authenticated: true;
  user: { id: string; email: string; displayName?: string | null };
  session: { id: string; application: string; expiresAt: string; organizationId?: string | null; storeId?: string | null };
  principal: SessionPrincipal;
  access: { allowed: true; application: string; reason: "ALLOWED"; permissions: Permission[]; organizationId: string; storeId?: string | null };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function sessionTokenFromCookie(request: Request, config: AppConfig): string | null {
  const raw = readCookie(request, config.sessionCookieName);
  if (!raw || raw.length > 8192) return null;
  try {
    const parsed = object(JSON.parse(raw));
    const token = typeof parsed?.sessionToken === "string" ? parsed.sessionToken : null;
    return token && /^[A-Za-z0-9_-]{40,4096}$/u.test(token) ? token : null;
  } catch {
    return null;
  }
}

export async function resolveCoreSession(
  request: Request,
  config: AppConfig,
  application: "POS",
  options: { organizationId?: string; storeId?: string } = {}
): Promise<CoreResolvedSession | null> {
  const sessionToken = sessionTokenFromCookie(request, config);
  if (!sessionToken) return null;
  if (!config.coreApiOrigin || !config.coreApiServiceSecret) {
    throw new AppError(503, "CORE_API_NOT_CONFIGURED", "The Core API authorization boundary is not configured");
  }
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  const csrfCookie = readCookie(request, config.csrfCookieName ?? "aevo_pos_csrf");
  const csrfHeader = request.headers.get("x-csrf-token");
  if (isMutation && (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader)) {
    throw new AppError(403, "CSRF_INVALID", "The security token is missing or invalid");
  }
  const response = await fetch(new URL("/internal/auth/sessions/resolve", `${config.coreApiOrigin.replace(/\/+$/u, "")}/`), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-aevo-core-secret": config.coreApiServiceSecret },
    body: JSON.stringify({ sessionToken, application, ...options, ...(isMutation && csrfHeader ? { csrfToken: csrfHeader } : {}) })
  });
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 401) return null;
  if (!response.ok) {
    const error = object(object(payload)?.error);
    throw new AppError(response.status === 403 ? 403 : 503, typeof error?.code === "string" ? error.code : "CORE_AUTHORIZATION_FAILED", typeof error?.message === "string" ? error.message : "The Core API authorization check failed");
  }
  const value = object(payload);
  const user = object(value?.user);
  const session = object(value?.session);
  const principal = object(value?.principal);
  const access = object(value?.access);
  if (!value?.authenticated || typeof user?.id !== "string" || typeof user.email !== "string" || typeof session?.id !== "string" || typeof session.expiresAt !== "string" || typeof principal?.userId !== "string" || typeof principal.organizationId !== "string" || typeof principal.membershipId !== "string" || typeof principal.role !== "string" || !Array.isArray(principal.permissions) || !access?.allowed) return null;
  const permissions = principal.permissions.filter((permission): permission is Permission => typeof permission === "string");
  return {
    authenticated: true,
    user: { id: user.id, email: user.email, ...(typeof user.displayName === "string" ? { displayName: user.displayName } : {}) },
    session: {
      id: session.id,
      application: typeof session.application === "string" ? session.application : application,
      expiresAt: session.expiresAt,
      ...(typeof session.organizationId === "string" ? { organizationId: session.organizationId } : {}),
      ...(typeof session.storeId === "string" ? { storeId: session.storeId } : {})
    },
    principal: {
      userId: principal.userId,
      email: typeof principal.email === "string" ? principal.email : user.email,
      ...(typeof principal.displayName === "string" ? { displayName: principal.displayName } : {}),
      organizationId: principal.organizationId,
      membershipId: principal.membershipId,
      role: principal.role as Role,
      permissions
    },
    access: {
      allowed: true,
      application: typeof access.application === "string" ? access.application : application,
      reason: "ALLOWED",
      permissions,
      organizationId: principal.organizationId,
      ...(typeof access.storeId === "string" ? { storeId: access.storeId } : {})
    }
  };
}

export async function refreshCoreSession(
  request: Request,
  config: AppConfig,
  application: "POS"
): Promise<CoreSessionPayload | null> {
  const sessionToken = sessionTokenFromCookie(request, config);
  const csrfToken = request.headers.get("x-csrf-token");
  if (!sessionToken || !csrfToken) return null;
  if (!config.coreApiOrigin || !config.coreApiServiceSecret) {
    throw new AppError(503, "CORE_API_NOT_CONFIGURED", "The Core API authorization boundary is not configured");
  }
  const response = await fetch(new URL("/internal/auth/sessions/refresh", `${config.coreApiOrigin.replace(/\/+$/u, "")}/`), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-aevo-core-secret": config.coreApiServiceSecret },
    body: JSON.stringify({ sessionToken, application, csrfToken })
  });
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 401) return null;
  if (!response.ok) {
    const error = object(object(payload)?.error);
    throw new AppError(response.status === 403 ? 403 : 503, typeof error?.code === "string" ? error.code : "CORE_SESSION_REFRESH_FAILED", typeof error?.message === "string" ? error.message : "The Core API session could not be refreshed");
  }
  return coreSessionCredentials(payload);
}

export async function revokeCoreSession(
  request: Request,
  config: AppConfig,
  application: "POS"
): Promise<boolean> {
  const sessionToken = sessionTokenFromCookie(request, config);
  if (!sessionToken) return true;
  if (!config.accountsApiOrigin || !config.accountsExchangeSecret) {
    throw new AppError(503, "ACCOUNTS_NOT_CONFIGURED", "The Accounts authentication boundary is not configured");
  }
  const response = await fetch(new URL("/v1/auth/logout", `${config.accountsApiOrigin.replace(/\/+$/u, "")}/`), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-aevo-accounts-secret": config.accountsExchangeSecret },
    body: JSON.stringify({ sessionToken, application })
  });
  return response.ok;
}

export function coreSessionCredentials(value: unknown): CoreSessionPayload | null {
  const session = object(value);
  if (typeof session?.sessionToken !== "string" || typeof session.csrfToken !== "string" || typeof session.expiresAt !== "string" || !/^[A-Za-z0-9_-]{40,4096}$/u.test(session.sessionToken) || !/^[A-Za-z0-9_-]{40,4096}$/u.test(session.csrfToken)) return null;
  return { sessionToken: session.sessionToken, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
}
