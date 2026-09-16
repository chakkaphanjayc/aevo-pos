import { randomUUID } from "node:crypto";
import { AuthenticationError, AuthService, hasPermission } from "@aevo/auth";
import type { AppConfig } from "@aevo/config";
import type { SessionPrincipal } from "@aevo/contracts";
import type { Database } from "@aevo/db";
import { listAuthorizedStores } from "@aevo/db";
import { Elysia, t } from "elysia";
import { AppError, forbidden, unauthorized } from "./errors";
import { clearSessionCookie, clientIp, readCookie, sessionCookie } from "./http";
import { createLogger } from "./logger";
import { FixedWindowRateLimiter } from "./rate-limit";

export interface AppDependencies {
  config: AppConfig;
  sql: Database;
  auth?: Pick<AuthService, "login" | "logout" | "resolve">;
}

export function createApp(dependencies: AppDependencies) {
  const { config, sql } = dependencies;
  const auth = dependencies.auth ?? new AuthService(sql, config.sessionTtlHours);
  const logger = createLogger(config.logLevel);
  const loginLimiter = new FixedWindowRateLimiter(10, 60_000);
  const secureCookie = config.nodeEnv === "production";

  async function authenticate(request: Request): Promise<SessionPrincipal> {
    const token = readCookie(request, config.sessionCookieName);
    if (!token) throw unauthorized();
    const requestedOrganizationId = request.headers.get("x-organization-id") ?? undefined;
    let organizationId: string | undefined;
    if (requestedOrganizationId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOrganizationId)) throw unauthorized();
      organizationId = requestedOrganizationId;
    }
    const principal = await auth.resolve(token, organizationId);
    if (!principal) throw unauthorized();
    return principal;
  }

  return new Elysia({ name: "aevo-api" })
    .derive({ as: "global" }, ({ request, set }) => {
      const requestId = request.headers.get("x-request-id")?.slice(0, 128) || randomUUID();
      set.headers["x-request-id"] = requestId;
      set.headers["access-control-allow-origin"] = config.webOrigin;
      set.headers["access-control-allow-credentials"] = "true";
      set.headers["vary"] = "Origin";
      return { requestId };
    })
    .onAfterHandle({ as: "global" }, ({ request, requestId, set }) => {
      logger.info("http.request", { requestId, method: request.method, path: new URL(request.url).pathname, status: set.status });
    })
    .onError({ as: "global" }, ({ error, requestId, set, code }) => {
      const known = error instanceof AppError || error instanceof AuthenticationError;
      const status = error instanceof AppError ? error.status : error instanceof AuthenticationError ? 401 : code === "VALIDATION" ? 422 : 500;
      const errorCode = error instanceof AppError ? error.code : error instanceof AuthenticationError ? error.code : code === "VALIDATION" ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      set.status = status;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger[status >= 500 ? "error" : "warn"]("http.error", { requestId, code: errorCode, status, message: errorMessage });
      return { error: { code: errorCode, message: known || code === "VALIDATION" ? errorMessage : "An unexpected error occurred", requestId } };
    })
    .options("/*", ({ set }) => {
      set.status = 204;
      set.headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
      set.headers["access-control-allow-headers"] = "content-type,x-organization-id,x-request-id";
      return "";
    })
    .get("/health", ({ requestId }) => ({ status: "ok", service: "aevo-api", requestId }))
    .get("/ready", async ({ requestId }) => {
      await sql`SELECT 1 AS ready`;
      return { status: "ready", requestId };
    })
    .post("/api/auth/login", async ({ body, request, requestId, set }) => {
      const ipAddress = clientIp(request);
      if (!loginLimiter.consume(ipAddress ?? "unknown")) throw new AppError(429, "RATE_LIMITED", "Too many login attempts");
      const result = await auth.login({
        email: body.email, password: body.password,
        ...(ipAddress ? { ipAddress } : {}),
        ...(request.headers.get("user-agent") ? { userAgent: request.headers.get("user-agent")! } : {})
      });
      set.headers["set-cookie"] = sessionCookie(config.sessionCookieName, result.token, result.expiresAt, secureCookie);
      set.status = 204;
      logger.info("auth.login", { requestId });
      return "";
    }, { body: t.Object({ email: t.String({ format: "email", maxLength: 320 }), password: t.String({ minLength: 1, maxLength: 1024 }) }) })
    .post("/api/auth/logout", async ({ request, set, requestId }) => {
      const token = readCookie(request, config.sessionCookieName);
      if (token) await auth.logout(token);
      set.headers["set-cookie"] = clearSessionCookie(config.sessionCookieName, secureCookie);
      set.status = 204;
      logger.info("auth.logout", { requestId });
      return "";
    })
    .get("/api/auth/me", async ({ request }) => {
      const principal = await authenticate(request);
      return { user: principal };
    })
    .get("/api/stores", async ({ request }) => {
      const principal = await authenticate(request);
      if (!hasPermission(principal, "store.read")) throw forbidden();
      return { stores: await listAuthorizedStores(sql, principal) };
    });
}
