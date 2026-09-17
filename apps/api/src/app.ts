import { randomUUID } from "node:crypto";
import { AuthenticationError, AuthService, hasPermission } from "@aevo/auth";
import type { AppConfig } from "@aevo/config";
import { deviceModes, roles } from "@aevo/contracts";
import type { DeviceMode, Permission, Role, SessionPrincipal } from "@aevo/contracts";
import type { Database } from "@aevo/db";
import {
  canAccessStore,
  CatalogConflictError,
  createCategory,
  createMenu,
  createMenuItem,
  createModifierGroup,
  createProduct,
  createProductModifierGroup,
  deleteProductModifierGroup,
  listAuthorizedStores,
  listCatalog,
  createOrder,
  createPublicOrder,
  getPublicOrderByToken,
  getOrder,
  getPublicCatalog,
  listOrders,
  OrderConflictError,
  OrderNotFoundError,
  OrderValidationError,
  recordOrderPayment,
  transitionOrder,
  updateProduct,
  updateProductAvailability,
  createQueueTicket,
  getQueueTicketByOrderId,
  getQueueTicketById,
  listQueueTickets,
  transitionQueueTicket,
  getQueueDisplaySnapshot,
  QueueError,
  listPreparationStations,
  listPreparationTasks,
  completePreparationTask,
  routeOrderToStations,
  checkOrderReadiness,
  PreparationError,
  createReceiptFromOrder,
  getReceiptById,
  getReceiptByOrderId,
  reprintReceipt,
  voidReceipt,
  formatReceiptThermalText,
  getCurrentCashSession,
  openCashSession,
  recordCashMovement,
  closeCashSession,
  listCashSessions,
  createDailyClosing,
  getDailyClosing,
  listDailyClosings,
  listDevices,
  createDevice,
  findPairingDevice,
  pairDevice,
  findDeviceByTokenHash,
  touchDevice,
  revokeDevice,
  listMembers,
  updateMember,
  listAuditLogs,
  writeAuditLog
} from "@aevo/db";
import { InvalidOrderTransitionError } from "@aevo/ordering";
import { createStoreRoomBroadcaster, type RealtimeEventName, type RealtimePayloadMap } from "@aevo/realtime";
import { calculateDailySummary, calculateHourlySales, calculateProductMix } from "@aevo/reporting";
import { Elysia, t } from "elysia";
import { AppError, forbidden, unauthorized } from "./errors";
import { clearSessionCookie, clientIp, decodeAuthSessionCookie, encodeAuthSessionCookie, readCookie, sessionCookie } from "./http";
import { createLogger } from "./logger";
import { FixedWindowRateLimiter } from "./rate-limit";

export interface AppDependencies {
  config: AppConfig;
  database: Database;
  auth?: Pick<AuthService, "login" | "logout" | "resolve" | "refresh">;
}

export function createApp(dependencies: AppDependencies) {
  const { config, database } = dependencies;
  const auth = dependencies.auth ?? new AuthService(database);
  const logger = createLogger(config.logLevel);
  const loginLimiter = new FixedWindowRateLimiter(10, 60_000);
  const publicOrderLimiter = new FixedWindowRateLimiter(10, 60_000);
  const publicReadLimiter = new FixedWindowRateLimiter(120, 60_000);
  const devicePairLimiter = new FixedWindowRateLimiter(12, 60_000);
  const secureCookie = config.nodeEnv === "production";
  const cookieSameSite = config.sessionCookieSameSite ?? "lax";
  const catalogChannelSchema = t.Union([
    t.Literal("POS"), t.Literal("QR"), t.Literal("KIOSK"),
    t.Literal("PICKUP"), t.Literal("STAFF"), t.Literal("API")
  ]);

  function assertAllowedOrigin(request: Request): void {
    const origin = request.headers.get("origin");
    if (origin && origin !== config.webOrigin) {
      throw new AppError(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed");
    }
  }

  async function authenticate(request: Request): Promise<SessionPrincipal> {
    const rawCookie = readCookie(request, config.sessionCookieName);
    const cookie = rawCookie ? decodeAuthSessionCookie(rawCookie) : null;
    // A raw token is accepted for one-way compatibility with pre-Supabase
    // sessions; new logins always write the structured token pair.
    const accessToken = cookie?.accessToken ?? rawCookie;
    if (!accessToken) throw unauthorized();
    const requestedOrganizationId = request.headers.get("x-organization-id") ?? undefined;
    let organizationId: string | undefined;
    if (requestedOrganizationId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOrganizationId)) throw unauthorized();
      organizationId = requestedOrganizationId;
    }
    const principal = await auth.resolve(accessToken, organizationId);
    if (!principal) throw unauthorized();
    return principal;
  }

  async function authenticateStore(request: Request, storeId: string, permission: Permission) {
    const principal = await authenticate(request);
    if (!hasPermission(principal, permission)) throw forbidden();
    if (!await canAccessStore(database, principal, storeId)) throw forbidden();
    const rawDeviceToken = request.headers.get("x-device-token")?.trim();
    if (rawDeviceToken) {
      const device = await findDeviceByTokenHash(database, await hashSecret(rawDeviceToken));
      if (!device || device.storeId !== storeId) throw forbidden();
      await touchDevice(database, device.id);
    }
    return principal;
  }

  function rethrowCatalogError(error: unknown): never {
    if (error instanceof CatalogConflictError) throw new AppError(409, "CATALOG_CONFLICT", error.message);
    throw error;
  }

  function rethrowOrderError(error: unknown): never {
    if (error instanceof OrderValidationError || error instanceof InvalidOrderTransitionError) {
      throw new AppError(422, error instanceof InvalidOrderTransitionError ? error.code : "ORDER_VALIDATION_ERROR", error.message);
    }
    if (error instanceof OrderConflictError) throw new AppError(409, "ORDER_CONFLICT", error.message);
    if (error instanceof OrderNotFoundError) throw new AppError(404, "ORDER_NOT_FOUND", error.message);
    throw error;
  }

  function rethrowQueueError(error: unknown): never {
    if (error instanceof QueueError) throw new AppError(400, error.code, error.message);
    throw error;
  }

  function rethrowPreparationError(error: unknown): never {
    if (error instanceof PreparationError) throw new AppError(400, error.code, error.message);
    throw error;
  }

  function idempotencyKey(request: Request): string {
    return request.headers.get("idempotency-key")?.trim() ?? "";
  }

  async function hashSecret(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function newPairingCode(): string {
    return randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  }

  function orderActionPermission(status: string): Permission {
    if (status === "CANCELLED") return "order.void";
    if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "refund.create";
    return "order.create";
  }

  async function broadcastStoreEvent<E extends RealtimeEventName>(
    storeId: string,
    event: E,
    payload: RealtimePayloadMap[E]
  ): Promise<void> {
    if (typeof (database.client as { channel?: unknown })?.channel === "function") {
      const broadcaster = createStoreRoomBroadcaster(database.client as never, storeId);
      await broadcaster.broadcast(event, payload);
    }
  }

  function publicOrderProjection(order: Awaited<ReturnType<typeof getPublicOrderByToken>>) {
    if (!order) return null;
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentType: order.fulfillmentType,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      customerName: order.customerName,
      items: order.items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        quantity: item.quantity,
        subtotalMinor: item.subtotalMinor,
        modifiers: item.modifiers.map((modifier) => ({ name: modifier.name }))
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      publicTrackingToken: order.publicTrackingToken
    };
  }

  return new Elysia({ name: "aevo-api" })
    .derive({ as: "global" }, ({ request, set }) => {
      const requestId = request.headers.get("x-request-id")?.slice(0, 128) || randomUUID();
      set.headers["x-request-id"] = requestId;
      const origin = request.headers.get("origin");
      if (!origin || origin === config.webOrigin) {
        set.headers["access-control-allow-origin"] = config.webOrigin;
        set.headers["access-control-allow-credentials"] = "true";
      }
      set.headers["vary"] = "Origin";
      set.headers["cache-control"] = "no-store";
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["referrer-policy"] = "no-referrer";
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
      set.headers["access-control-allow-methods"] = "GET,POST,PATCH,DELETE,OPTIONS";
      set.headers["access-control-allow-headers"] = "accept,content-type,x-organization-id,x-request-id,idempotency-key,x-device-token";
      set.headers["access-control-expose-headers"] = "x-request-id";
      set.headers["access-control-max-age"] = "600";
      return "";
    })
    .get("/health", ({ requestId }) => ({ status: "ok", service: "aevo-api", requestId }))
    .get("/ready", async ({ requestId }) => {
      await database.ping();
      return { status: "ready", requestId };
    })
    .post("/api/auth/login", async ({ body, request, requestId, set }) => {
      assertAllowedOrigin(request);
      const ipAddress = clientIp(request);
      if (!loginLimiter.consume(ipAddress ?? "unknown")) throw new AppError(429, "RATE_LIMITED", "Too many login attempts");
      const result = await auth.login({
        email: body.email, password: body.password,
        ...(ipAddress ? { ipAddress } : {}),
        ...(request.headers.get("user-agent") ? { userAgent: request.headers.get("user-agent")! } : {})
      });
      set.headers["set-cookie"] = sessionCookie(
        config.sessionCookieName,
        encodeAuthSessionCookie({ accessToken: result.accessToken, refreshToken: result.refreshToken }),
        result.expiresAt,
        secureCookie,
        cookieSameSite
      );
      set.status = 204;
      logger.info("auth.login", { requestId });
      return "";
    }, { body: t.Object({ email: t.String({ format: "email", maxLength: 320 }), password: t.String({ minLength: 1, maxLength: 1024 }) }) })
    .post("/api/auth/refresh", async ({ request, requestId, set }) => {
      assertAllowedOrigin(request);
      const rawCookie = readCookie(request, config.sessionCookieName);
      const cookie = rawCookie ? decodeAuthSessionCookie(rawCookie) : null;
      if (!cookie?.refreshToken) throw unauthorized();
      const result = await auth.refresh(cookie.refreshToken);
      set.headers["set-cookie"] = sessionCookie(
        config.sessionCookieName,
        encodeAuthSessionCookie({ accessToken: result.accessToken, refreshToken: result.refreshToken }),
        result.expiresAt,
        secureCookie,
        cookieSameSite
      );
      set.status = 204;
      logger.info("auth.refresh", { requestId });
      return "";
    })
    .post("/api/auth/logout", async ({ request, set, requestId }) => {
      assertAllowedOrigin(request);
      const rawCookie = readCookie(request, config.sessionCookieName);
      const cookie = rawCookie ? decodeAuthSessionCookie(rawCookie) : null;
      if (cookie?.accessToken ?? rawCookie) {
        try {
          await auth.logout(cookie?.accessToken ?? rawCookie!);
        } catch (error) {
          // Always clear the browser cookie even if remote session revocation is
          // temporarily unavailable. The access JWT is short-lived and the
          // failure is recorded without logging the token.
          logger.warn("auth.logout.remote_failed", {
            requestId,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      set.headers["set-cookie"] = clearSessionCookie(config.sessionCookieName, secureCookie, cookieSameSite);
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
      return { stores: await listAuthorizedStores(database, principal) };
    })
    .get("/api/devices", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "devices.manage");
      return { devices: await listDevices(database, principal, query.storeId) };
    }, {
      query: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .post("/api/devices", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "devices.manage");
      const pairingCode = newPairingCode();
      const pairingExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      try {
        const device = await createDevice(database, principal, {
          storeId: body.storeId,
          name: body.name,
          mode: body.mode as DeviceMode,
          ...(body.stationId ? { stationId: body.stationId } : {}),
          pairingCodeHash: await hashSecret(pairingCode),
          pairingExpiresAt
        });
        await writeAuditLog(database, { organizationId: principal.organizationId, userId: principal.userId, action: "DEVICE_CREATED", resourceType: "device", resourceId: device.id, metadata: { storeId: body.storeId, mode: body.mode } });
        return { device, pairingCode, pairingExpiresAt };
      } catch (error) {
        throw new AppError(400, "DEVICE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create device");
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        name: t.String({ minLength: 1, maxLength: 120 }),
        mode: t.Union(deviceModes.map((mode) => t.Literal(mode)) as [ReturnType<typeof t.Literal>, ...ReturnType<typeof t.Literal>[]]),
        stationId: t.Optional(t.String({ format: "uuid" }))
      })
    })
    .post("/api/devices/pair", async ({ request, body }) => {
      const ip = clientIp(request) ?? "unknown";
      if (!devicePairLimiter.consume(ip)) throw new AppError(429, "RATE_LIMITED", "Too many pairing attempts. Please wait a moment.");
      const device = await findPairingDevice(database, await hashSecret(body.pairingCode.trim().toUpperCase()));
      if (!device) throw new AppError(401, "PAIRING_CODE_INVALID", "รหัสจับคู่อุปกรณ์ไม่ถูกต้องหรือหมดอายุ");
      const deviceToken = randomUUID() + randomUUID().replaceAll("-", "");
      const paired = await pairDevice(database, device.id, await hashSecret(deviceToken));
      if (!paired) throw new AppError(409, "DEVICE_PAIRING_FAILED", "ไม่สามารถจับคู่อุปกรณ์ได้ กรุณาสร้างรหัสใหม่");
      const storeResult = await database.client.from("stores").select("code").eq("id", paired.storeId).maybeSingle();
      return { device: paired, deviceToken, storeCode: storeResult.data?.code ? String(storeResult.data.code) : "" };
    }, {
      body: t.Object({ pairingCode: t.String({ minLength: 6, maxLength: 32 }) })
    })
    .get("/api/devices/me", async ({ request }) => {
      const rawToken = request.headers.get("x-device-token")?.trim();
      if (!rawToken) throw unauthorized();
      const device = await findDeviceByTokenHash(database, await hashSecret(rawToken));
      if (!device) throw unauthorized();
      await touchDevice(database, device.id);
      return { device };
    })
    .post("/api/devices/:deviceId/revoke", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "devices.manage");
      const revoked = await revokeDevice(database, principal, body.storeId, params.deviceId);
      if (!revoked) throw new AppError(404, "DEVICE_NOT_FOUND", "ไม่พบอุปกรณ์ในสาขานี้");
      await writeAuditLog(database, { organizationId: principal.organizationId, userId: principal.userId, action: "DEVICE_REVOKED", resourceType: "device", resourceId: params.deviceId, metadata: { storeId: body.storeId } });
      return { ok: true };
    }, {
      params: t.Object({ deviceId: t.String({ format: "uuid" }) }),
      body: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .get("/api/members", async ({ request }) => {
      const principal = await authenticate(request);
      if (!hasPermission(principal, "member.manage")) throw forbidden();
      return { members: await listMembers(database, principal) };
    })
    .patch("/api/members/:membershipId", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticate(request);
      if (!hasPermission(principal, "member.manage")) throw forbidden();
      const member = await updateMember(database, principal, params.membershipId, { role: body.role as Role, ...(body.status ? { status: body.status } : {}), storeIds: body.storeIds });
      if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "ไม่พบสมาชิกองค์กร");
      await writeAuditLog(database, { organizationId: principal.organizationId, userId: principal.userId, action: "MEMBER_UPDATED", resourceType: "membership", resourceId: params.membershipId, metadata: { role: body.role, status: body.status ?? "UNCHANGED", storeIds: body.storeIds } });
      return { member };
    }, {
      params: t.Object({ membershipId: t.String({ format: "uuid" }) }),
      body: t.Object({
        role: t.Union(roles.map((role) => t.Literal(role)) as [ReturnType<typeof t.Literal>, ...ReturnType<typeof t.Literal>[]]),
        status: t.Optional(t.Union([t.Literal("ACTIVE"), t.Literal("SUSPENDED")])),
        storeIds: t.Array(t.String({ format: "uuid" }), { maxItems: 100 })
      })
    })
    .get("/api/audit-logs", async ({ request, query }) => {
      const principal = await authenticate(request);
      if (!hasPermission(principal, "audit.read")) throw forbidden();
      return { logs: await listAuditLogs(database, principal, query.limit ? Number(query.limit) : 100) };
    }, {
      query: t.Object({ limit: t.Optional(t.String()) })
    })
    .get("/api/orders", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "order.read");
      try {
        return {
          orders: await listOrders(database, principal, query.storeId, {
            ...(query.status ? { status: query.status } : {}),
            ...(query.limit ? { limit: query.limit } : {})
          })
        };
      } catch (error) {
        return rethrowOrderError(error);
      }
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        status: t.Optional(t.Union([
          t.Literal("DRAFT"), t.Literal("PENDING_PAYMENT"), t.Literal("PAID"), t.Literal("CONFIRMED"),
          t.Literal("QUEUED"), t.Literal("ACCEPTED"), t.Literal("PREPARING"), t.Literal("PARTIALLY_READY"),
          t.Literal("READY"), t.Literal("SERVED"), t.Literal("PICKED_UP"), t.Literal("COMPLETED"),
          t.Literal("CANCELLED"), t.Literal("REFUNDED"), t.Literal("PARTIALLY_REFUNDED"), t.Literal("NO_SHOW")
        ])),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 }))
      })
    })
    .get("/api/orders/:orderId", async ({ request, params, query }) => {
      const principal = await authenticateStore(request, query.storeId, "order.read");
      try {
        return { order: await getOrder(database, principal, query.storeId, params.orderId) };
      } catch (error) {
        return rethrowOrderError(error);
      }
    }, {
      params: t.Object({ orderId: t.String({ format: "uuid" }) }),
      query: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .post("/api/orders", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "order.create");
      try {
        const order = await createOrder(database, principal, body, idempotencyKey(request));
        await broadcastStoreEvent(body.storeId, "order.created", { order });
        const queueTicket = await createQueueTicket(database, {
          organizationId: order.organizationId,
          storeId: order.storeId,
          orderId: order.id,
          orderNumber: order.orderNumber
        }).catch(() => null);
        if (queueTicket) {
          await broadcastStoreEvent(order.storeId, "queue.ticket", {
            ticketId: queueTicket.id,
            queueNumber: queueTicket.queueNumber,
            status: queueTicket.status,
            occurredAt: new Date().toISOString()
          });
        }
        await routeOrderToStations(database, {
          organizationId: order.organizationId,
          storeId: order.storeId,
          orderId: order.id
        }).catch(() => null);
        return { order, queueTicket };
      } catch (error) {
        return rethrowOrderError(error);
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        channel: catalogChannelSchema,
        fulfillmentType: t.Union([t.Literal("TAKEAWAY"), t.Literal("DINE_IN"), t.Literal("PICKUP")]),
        currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
        customerName: t.Optional(t.String({ maxLength: 160 })),
        customerPhone: t.Optional(t.String({ maxLength: 40 })),
        customerEmail: t.Optional(t.String({ format: "email", maxLength: 320 })),
        notes: t.Optional(t.String({ maxLength: 2000 })),
        scheduledPickupAt: t.Optional(t.String({ format: "date-time" })),
        items: t.Array(t.Object({
          productId: t.String({ format: "uuid" }),
          variantId: t.Optional(t.String({ format: "uuid" })),
          menuItemId: t.Optional(t.String({ format: "uuid" })),
          modifierIds: t.Optional(t.Array(t.String({ format: "uuid" }), { maxItems: 50 })),
          quantity: t.Integer({ minimum: 1, maximum: 999 }),
          note: t.Optional(t.String({ maxLength: 1000 }))
        }), { minItems: 1, maxItems: 100 })
      })
    })
    .post("/api/orders/:orderId/transition", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, orderActionPermission(body.toStatus));
      try {
        const order = await transitionOrder(database, principal, params.orderId, body, idempotencyKey(request));
        await broadcastStoreEvent(body.storeId, "order.status", {
          orderId: order.id,
          orderNumber: order.orderNumber,
          fromStatus: (body.expectedStatus as never) ?? "DRAFT",
          toStatus: order.status,
          occurredAt: new Date().toISOString()
        });

        // Synchronize queue ticket status with order lifecycle
        const qTicket = await getQueueTicketByOrderId(database, order.id).catch(() => null);
        if (qTicket) {
          let targetQueueStatus: "WAITING" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED" | null = null;
          if (order.status === "READY" && qTicket.status !== "READY" && qTicket.status !== "COMPLETED") {
            targetQueueStatus = "READY";
          } else if ((order.status === "COMPLETED" || order.status === "SERVED" || order.status === "PICKED_UP") && qTicket.status !== "COMPLETED") {
            targetQueueStatus = "COMPLETED";
          } else if ((order.status === "PREPARING" || order.status === "ACCEPTED") && qTicket.status === "WAITING") {
            targetQueueStatus = "PREPARING";
          } else if (order.status === "CANCELLED" && qTicket.status !== "CANCELLED" && qTicket.status !== "COMPLETED") {
            targetQueueStatus = "CANCELLED";
          }

          if (targetQueueStatus) {
            const updated = await transitionQueueTicket(database, qTicket.id, targetQueueStatus).catch(() => null);
            if (updated) {
              await broadcastStoreEvent(order.storeId, "queue.ticket", {
                ticketId: updated.id,
                queueNumber: updated.queueNumber,
                status: updated.status,
                occurredAt: new Date().toISOString()
              });
            }
          }
        }

        if (order.status === "CONFIRMED" || order.status === "ACCEPTED" || order.status === "PREPARING") {
          await routeOrderToStations(database, {
            organizationId: order.organizationId,
            storeId: order.storeId,
            orderId: order.id
          }).catch(() => null);
        }

        return { order };
      } catch (error) {
        return rethrowOrderError(error);
      }
    }, {
      params: t.Object({ orderId: t.String({ format: "uuid" }) }),
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        toStatus: t.Union([
          t.Literal("PENDING_PAYMENT"), t.Literal("PAID"), t.Literal("CONFIRMED"), t.Literal("QUEUED"),
          t.Literal("ACCEPTED"), t.Literal("PREPARING"), t.Literal("PARTIALLY_READY"), t.Literal("READY"),
          t.Literal("SERVED"), t.Literal("PICKED_UP"), t.Literal("COMPLETED"), t.Literal("CANCELLED"),
          t.Literal("REFUNDED"), t.Literal("PARTIALLY_REFUNDED"), t.Literal("NO_SHOW")
        ]),
        expectedStatus: t.Optional(t.Union([
          t.Literal("DRAFT"), t.Literal("PENDING_PAYMENT"), t.Literal("PAID"), t.Literal("CONFIRMED"),
          t.Literal("QUEUED"), t.Literal("ACCEPTED"), t.Literal("PREPARING"), t.Literal("PARTIALLY_READY"),
          t.Literal("READY"), t.Literal("SERVED"), t.Literal("PICKED_UP"), t.Literal("COMPLETED"),
          t.Literal("CANCELLED"), t.Literal("REFUNDED"), t.Literal("PARTIALLY_REFUNDED"), t.Literal("NO_SHOW")
        ])),
        reason: t.Optional(t.String({ maxLength: 500 }))
      })
    })
    .post("/api/orders/:orderId/payments", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "payment.receive");
      try {
        const order = await recordOrderPayment(database, principal, params.orderId, body, idempotencyKey(request));
        await broadcastStoreEvent(body.storeId, "order.payment", {
          orderId: order.id,
          paymentMethod: body.method,
          amountMinor: body.amountMinor,
          occurredAt: new Date().toISOString()
        });
        return { order };
      } catch (error) {
        return rethrowOrderError(error);
      }
    }, {
      params: t.Object({ orderId: t.String({ format: "uuid" }) }),
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        method: t.Union([t.Literal("CASH"), t.Literal("PROMPTPAY"), t.Literal("EXTERNAL_CARD"), t.Literal("MANUAL")]),
        amountMinor: t.Integer({ minimum: 1, maximum: 2147483647 }),
        currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
        providerReference: t.Optional(t.String({ maxLength: 200 }))
      })
    })
    .get("/api/catalog", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "catalog.read");
      return await listCatalog(database, principal, query.storeId);
    }, {
      query: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .get("/api/public/catalog", async ({ query }) => {
      const catalog = await getPublicCatalog(database, query.storeCode, (query.channel as never) || "QR");
      if (!catalog) throw new AppError(404, "STORE_NOT_FOUND", "Store was not found or is inactive");
      return catalog;
    }, {
      query: t.Object({
        storeCode: t.String({ minLength: 1, maxLength: 32 }),
        channel: t.Optional(catalogChannelSchema)
      })
    })
    .post("/api/public/orders", async ({ request, body }) => {
      const ip = clientIp(request) ?? "unknown";
      if (!publicOrderLimiter.consume(ip)) {
        throw new AppError(429, "RATE_LIMITED", "Too many orders submitted. Please wait a moment.");
      }
      try {
        const order = await createPublicOrder(database, body, idempotencyKey(request));
        await broadcastStoreEvent(order.storeId, "order.created", { order });
        const queueTicket = await createQueueTicket(database, {
          organizationId: order.organizationId,
          storeId: order.storeId,
          orderId: order.id,
          orderNumber: order.orderNumber
        }).catch(() => null);
        if (queueTicket) {
          await broadcastStoreEvent(order.storeId, "queue.ticket", {
            ticketId: queueTicket.id,
            queueNumber: queueTicket.queueNumber,
            status: queueTicket.status,
            occurredAt: new Date().toISOString()
          });
        }
        await routeOrderToStations(database, {
          organizationId: order.organizationId,
          storeId: order.storeId,
          orderId: order.id
        }).catch(() => null);
        return { order: publicOrderProjection(order), queueTicket: queueTicket ? {
          queueNumber: queueTicket.queueNumber,
          status: queueTicket.status
        } : null };
      } catch (error) {
        return rethrowOrderError(error);
      }
    }, {
      body: t.Object({
        storeCode: t.String({ minLength: 1, maxLength: 32 }),
        channel: t.Union([t.Literal("QR"), t.Literal("KIOSK")]),
        fulfillmentType: t.Union([t.Literal("TAKEAWAY"), t.Literal("DINE_IN"), t.Literal("PICKUP")]),
        tableNumber: t.Optional(t.String({ maxLength: 32 })),
        customerName: t.Optional(t.String({ maxLength: 160 })),
        customerPhone: t.Optional(t.String({ maxLength: 40 })),
        notes: t.Optional(t.String({ maxLength: 2000 })),
        scheduledPickupAt: t.Optional(t.String({ format: "date-time" })),
        items: t.Array(t.Object({
          productId: t.String({ format: "uuid" }),
          variantId: t.Optional(t.String({ format: "uuid" })),
          modifierIds: t.Optional(t.Array(t.String({ format: "uuid" }), { maxItems: 50 })),
          quantity: t.Integer({ minimum: 1, maximum: 999 }),
          note: t.Optional(t.String({ maxLength: 1000 }))
        }), { minItems: 1, maxItems: 100 })
      })
    })
    .get("/api/public/orders/track/:token", async ({ request, params, query }) => {
      const ip = clientIp(request) ?? "unknown";
      if (!publicReadLimiter.consume(ip)) throw new AppError(429, "RATE_LIMITED", "Too many tracking requests. Please wait a moment.");
      const order = await getPublicOrderByToken(database, query.storeCode, params.token);
      if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order tracking link is invalid or expired");
      const queueTicket = await getQueueTicketByOrderId(database, order.id).catch(() => null);
      return {
        storeCode: query.storeCode,
        order: publicOrderProjection(order),
        queue: queueTicket ? { number: queueTicket.queueNumber, status: queueTicket.status } : null
      };
    }, {
      params: t.Object({ token: t.String({ minLength: 32, maxLength: 128 }) }),
      query: t.Object({ storeCode: t.String({ minLength: 1, maxLength: 32 }) })
    })
    .get("/api/public/orders/receipt/:token", async ({ request, params, query }) => {
      const ip = clientIp(request) ?? "unknown";
      if (!publicReadLimiter.consume(ip)) throw new AppError(429, "RATE_LIMITED", "Too many receipt requests. Please wait a moment.");
      const order = await getPublicOrderByToken(database, query.storeCode, params.token);
      if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Receipt link is invalid or expired");
      const receipt = await getReceiptByOrderId(database, {
        userId: "",
        email: "anonymous@customer",
        organizationId: order.organizationId,
        membershipId: "",
        role: "VIEWER",
        permissions: []
      }, order.id);
      if (!receipt) throw new AppError(404, "RECEIPT_NOT_FOUND", "Receipt is not available yet");
      return {
        receipt: {
          receiptNumber: receipt.receiptNumber,
          orderNumber: receipt.orderNumber,
          store: receipt.storeSnapshot,
          items: receipt.itemsSnapshot,
          subtotalMinor: receipt.subtotalMinor,
          discountMinor: receipt.discountMinor,
          taxMinor: receipt.taxMinor,
          totalMinor: receipt.totalMinor,
          payments: receipt.paymentsSummary.map((payment) => ({ method: payment.method, amountMinor: payment.amountMinor })),
          createdAt: receipt.createdAt,
          isVoid: receipt.isVoid
        }
      };
    }, {
      params: t.Object({ token: t.String({ minLength: 32, maxLength: 128 }) }),
      query: t.Object({ storeCode: t.String({ minLength: 1, maxLength: 32 }) })
    })
    .get("/api/queue", async ({ request, query }) => {
      await authenticateStore(request, query.storeId, "store.read");
      const statuses = query.status ? (query.status.split(",") as any) : undefined;
      const tickets = await listQueueTickets(database, { storeId: query.storeId, statuses });
      return { tickets };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        status: t.Optional(t.String())
      })
    })
    .get("/api/public/queue/:storeCode", async ({ params }) => {
      const snapshot = await getQueueDisplaySnapshot(database, params.storeCode);
      if (!snapshot) throw new AppError(404, "STORE_NOT_FOUND", "Store was not found or is inactive");
      return snapshot;
    }, {
      params: t.Object({ storeCode: t.String({ minLength: 1, maxLength: 32 }) })
    })
    .post("/api/queue/:ticketId/call", async ({ request, params }) => {
      assertAllowedOrigin(request);
      const ticket = await getQueueTicketById(database, params.ticketId);
      if (!ticket) throw new AppError(404, "QUEUE_TICKET_NOT_FOUND", "Queue ticket not found");
      await authenticateStore(request, ticket.storeId, "order.create");
      try {
        const updated = await transitionQueueTicket(database, params.ticketId, "READY");
        await broadcastStoreEvent(updated.storeId, "queue.ticket", {
          ticketId: updated.id,
          queueNumber: updated.queueNumber,
          status: updated.status,
          occurredAt: new Date().toISOString()
        });
        return { ticket: updated };
      } catch (error) {
        return rethrowQueueError(error);
      }
    }, {
      params: t.Object({ ticketId: t.String({ format: "uuid" }) })
    })
    .post("/api/queue/:ticketId/complete", async ({ request, params }) => {
      assertAllowedOrigin(request);
      const ticket = await getQueueTicketById(database, params.ticketId);
      if (!ticket) throw new AppError(404, "QUEUE_TICKET_NOT_FOUND", "Queue ticket not found");
      await authenticateStore(request, ticket.storeId, "order.create");
      try {
        const updated = await transitionQueueTicket(database, params.ticketId, "COMPLETED");
        await broadcastStoreEvent(updated.storeId, "queue.ticket", {
          ticketId: updated.id,
          queueNumber: updated.queueNumber,
          status: updated.status,
          occurredAt: new Date().toISOString()
        });
        return { ticket: updated };
      } catch (error) {
        return rethrowQueueError(error);
      }
    }, {
      params: t.Object({ ticketId: t.String({ format: "uuid" }) })
    })
    .get("/api/preparation/stations", async ({ request, query }) => {
      await authenticateStore(request, query.storeId, "store.read");
      const stations = await listPreparationStations(database, query.storeId);
      return { stations };
    }, {
      query: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .get("/api/preparation/tasks", async ({ request, query }) => {
      await authenticateStore(request, query.storeId, "order.create");
      const tasks = await listPreparationTasks(database, {
        storeId: query.storeId,
        ...(query.stationId ? { stationId: query.stationId } : {}),
        ...(query.status ? { status: query.status.split(",") as any } : {})
      });
      return { tasks };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        stationId: t.Optional(t.String({ format: "uuid" })),
        status: t.Optional(t.String())
      })
    })
    .post("/api/preparation/tasks/:taskId/complete", async ({ request, params }) => {
      assertAllowedOrigin(request);
      const principal = await authenticate(request);
      if (!hasPermission(principal, "order.create")) throw forbidden();
      try {
        const completedTask = await completePreparationTask(database, {
          taskId: params.taskId,
          completedBy: principal.userId
        });
        await broadcastStoreEvent(completedTask.storeId, "preparation.task", {
          taskId: completedTask.id,
          orderId: completedTask.orderId,
          stationId: completedTask.stationId,
          status: completedTask.status,
          occurredAt: new Date().toISOString()
        });

        // Check readiness of order
        const readiness = await checkOrderReadiness(database, completedTask.orderId);
        if (readiness === "READY") {
          const qTicket = await getQueueTicketByOrderId(database, completedTask.orderId).catch(() => null);
          if (qTicket && qTicket.status !== "READY" && qTicket.status !== "COMPLETED") {
            const updatedQT = await transitionQueueTicket(database, qTicket.id, "READY").catch(() => null);
            if (updatedQT) {
              await broadcastStoreEvent(completedTask.storeId, "queue.ticket", {
                ticketId: updatedQT.id,
                queueNumber: updatedQT.queueNumber,
                status: updatedQT.status,
                occurredAt: new Date().toISOString()
              });
            }
          }
        }

        return { task: completedTask, readiness };
      } catch (error) {
        return rethrowPreparationError(error);
      }
    }, {
      params: t.Object({ taskId: t.String({ format: "uuid" }) })
    })
    .post("/api/push/subscribe", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const { data: store } = await database.client
        .from("stores")
        .select("organization_id")
        .eq("id", body.storeId)
        .single();
      if (!store) throw new AppError(404, "STORE_NOT_FOUND", "Store not found");

      const subRecord = {
        organization_id: store.organization_id,
        store_id: body.storeId,
        platform: body.platform,
        device_token: body.deviceToken ?? null,
        web_push_subscription: body.endpoint ? {
          endpoint: body.endpoint,
          keys: {
            p256dh: body.p256dh ?? "",
            auth: body.auth ?? ""
          }
        } : null
      };

      await database.client.from("push_subscriptions").insert(subRecord);
      return { ok: true };
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        platform: t.Union([t.Literal("WEB"), t.Literal("IOS"), t.Literal("ANDROID")]),
        endpoint: t.Optional(t.String()),
        p256dh: t.Optional(t.String()),
        auth: t.Optional(t.String()),
        deviceToken: t.Optional(t.String())
      })
    })
    .post("/api/webhooks/line", async ({ body }) => {
      return { ok: true, eventsReceived: (body as any)?.events?.length ?? 0 };
    }, {
      body: t.Any()
    })
    .get("/api/reports/daily", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "audit.read");
      const targetDate = query.date || new Date().toISOString().split("T")[0] || "2026-01-01";
      const startOfDay = `${targetDate}T00:00:00Z`;
      const endOfDay = `${targetDate}T23:59:59Z`;

      const [ordersRes, paymentsRes] = await Promise.all([
        database.client
          .from("orders")
          .select("total_minor, status")
          .eq("organization_id", principal.organizationId)
          .eq("store_id", query.storeId)
          .gte("created_at", startOfDay)
          .lte("created_at", endOfDay),
        database.client
          .from("payments")
          .select("method, amount_minor")
          .eq("organization_id", principal.organizationId)
          .eq("store_id", query.storeId)
          .gte("created_at", startOfDay)
          .lte("created_at", endOfDay)
      ]);

      const orders = (ordersRes.data ?? []).map((r: any) => ({
        totalMinor: Number(r.total_minor || 0),
        status: String(r.status || "")
      }));

      const payments = (paymentsRes.data ?? []).map((r: any) => ({
        method: String(r.method || ""),
        amountMinor: Number(r.amount_minor || 0)
      }));

      const summary = calculateDailySummary(targetDate, orders, payments);
      return { summary };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        date: t.Optional(t.String())
      })
    })
    .get("/api/reports/product-mix", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "audit.read");
      const from = query.from || new Date(Date.now() - 30 * 86400000).toISOString();
      const to = query.to || new Date().toISOString();

      const { data } = await database.client
        .from("order_items")
        .select("product_id, product_name, quantity, subtotal_minor, orders!inner(store_id, created_at, status)")
        .eq("orders.organization_id", principal.organizationId)
        .eq("orders.store_id", query.storeId)
        .neq("orders.status", "CANCELLED")
        .gte("orders.created_at", from)
        .lte("orders.created_at", to);

      const items = (data ?? []).map((r: any) => ({
        productId: String(r.product_id),
        productName: String(r.product_name || "Unknown"),
        quantity: Number(r.quantity || 1),
        subtotalMinor: Number(r.subtotal_minor || 0)
      }));

      const mix = calculateProductMix(items);
      return { productMix: mix };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        from: t.Optional(t.String()),
        to: t.Optional(t.String())
      })
    })
    .get("/api/reports/hourly", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "audit.read");
      const targetDate = query.date || new Date().toISOString().split("T")[0] || "2026-01-01";
      const startOfDay = `${targetDate}T00:00:00Z`;
      const endOfDay = `${targetDate}T23:59:59Z`;

      const { data } = await database.client
        .from("orders")
        .select("created_at, total_minor, status")
        .eq("organization_id", principal.organizationId)
        .eq("store_id", query.storeId)
        .gte("created_at", startOfDay)
        .lte("created_at", endOfDay);

      const orders = (data ?? []).map((r: any) => ({
        createdAt: String(r.created_at),
        totalMinor: Number(r.total_minor || 0),
        status: String(r.status || "")
      }));

      const buckets = calculateHourlySales(orders);
      return { hourly: buckets };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        date: t.Optional(t.String())
      })
    })
    .get("/api/tables", async ({ request, query }) => {
      await authenticateStore(request, query.storeId, "store.read");
      const [floorsRes, tablesRes] = await Promise.all([
        database.client
          .from("floors")
          .select("id, name, display_order, width, height")
          .eq("store_id", query.storeId)
          .order("display_order", { ascending: true }),
        database.client
          .from("tables")
          .select("id, floor_id, table_number, label, status, position_x, position_y, shape, seats, current_order_id")
          .eq("store_id", query.storeId)
          .order("table_number", { ascending: true })
      ]);
      return {
        floors: floorsRes.data ?? [],
        tables: tablesRes.data ?? []
      };
    }, {
      query: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .patch("/api/tables/:tableId/status", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      await authenticateStore(request, body.storeId, "order.create");
      const updatePayload: Record<string, unknown> = {
        status: body.status,
        current_order_id: body.currentOrderId ?? null
      };
      const { data, error } = await database.client
        .from("tables")
        .update(updatePayload)
        .eq("id", params.tableId)
        .select()
        .single();
      if (error || !data) throw new AppError(400, "TABLE_UPDATE_FAILED", error?.message || "Failed to update table");
      return { table: data };
    }, {
      params: t.Object({ tableId: t.String({ format: "uuid" }) }),
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        status: t.String(),
        currentOrderId: t.Optional(t.Nullable(t.String({ format: "uuid" })))
      })
    })
    .post("/api/catalog/categories", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "catalog.manage");
      try {
        return { category: await createCategory(database, principal, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        name: t.String({ minLength: 1, maxLength: 160 }),
        code: t.Optional(t.String({ minLength: 1, maxLength: 32 })),
        parentId: t.Optional(t.String({ format: "uuid" }))
      })
    })
    .post("/api/catalog/products", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "catalog.manage");
      try {
        return { product: await createProduct(database, principal, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        categoryId: t.Optional(t.String({ format: "uuid" })),
        sku: t.String({ minLength: 1, maxLength: 64 }),
        name: t.String({ minLength: 1, maxLength: 160 }),
        description: t.Optional(t.String({ maxLength: 2000 })),
        basePriceMinor: t.Integer({ minimum: 0, maximum: 2147483647 }),
        currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
        variants: t.Optional(t.Array(t.Object({
          code: t.String({ minLength: 1, maxLength: 32 }),
          name: t.String({ minLength: 1, maxLength: 160 }),
          priceMinor: t.Integer({ minimum: 0, maximum: 2147483647 })
        }), { maxItems: 32 }))
      })
    })
    .post("/api/catalog/menus", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "catalog.manage");
      try {
        return { menu: await createMenu(database, principal, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        code: t.Optional(t.String({ minLength: 1, maxLength: 32 })),
        name: t.String({ minLength: 1, maxLength: 160 }),
        channel: catalogChannelSchema
      })
    })
    .post("/api/catalog/menu-items", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "catalog.manage");
      try {
        return { menuItem: await createMenuItem(database, principal, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        menuId: t.String({ format: "uuid" }),
        productId: t.String({ format: "uuid" }),
        variantId: t.Optional(t.String({ format: "uuid" })),
        priceOverrideMinor: t.Optional(t.Nullable(t.Integer({ minimum: 0, maximum: 2147483647 })))
      })
    })
    .post("/api/catalog/modifier-groups", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "catalog.manage");
      try {
        return { modifierGroup: await createModifierGroup(database, principal, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        code: t.Optional(t.String({ minLength: 1, maxLength: 32 })),
        name: t.String({ minLength: 1, maxLength: 160 }),
        selectionType: t.Optional(t.Union([t.Literal("SINGLE"), t.Literal("MULTIPLE")])),
        minSelections: t.Optional(t.Integer({ minimum: 0, maximum: 99 })),
        maxSelections: t.Optional(t.Integer({ minimum: 0, maximum: 99 })),
        required: t.Optional(t.Boolean()),
        modifiers: t.Optional(t.Array(t.Object({
          code: t.String({ minLength: 1, maxLength: 32 }),
          name: t.String({ minLength: 1, maxLength: 160 }),
          priceDeltaMinor: t.Optional(t.Integer({ minimum: -2147483648, maximum: 2147483647 }))
        }), { maxItems: 99 }))
      })
    })
    .patch("/api/catalog/products/:productId", async ({ request, params, query, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, query.storeId, "catalog.manage");
      try {
        return { product: await updateProduct(database, principal, params.productId, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      query: t.Object({ storeId: t.String({ format: "uuid" }) }),
      body: t.Object({
        categoryId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        name: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
        description: t.Optional(t.String({ maxLength: 2000 })),
        basePriceMinor: t.Optional(t.Integer({ minimum: 0, maximum: 2147483647 })),
        status: t.Optional(t.Union([t.Literal("ACTIVE"), t.Literal("ARCHIVED")]))
      })
    })
    .patch("/api/catalog/products/:productId/availability", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "catalog.manage");
      try {
        return { availability: await updateProductAvailability(database, principal, params.productId, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        channel: catalogChannelSchema,
        isAvailable: t.Optional(t.Boolean()),
        soldOut: t.Optional(t.Boolean()),
        priceOverrideMinor: t.Optional(t.Nullable(t.Integer({ minimum: 0, maximum: 2147483647 })))
      })
    })
    .post("/api/catalog/product-modifier-groups", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "catalog.manage");
      try {
        return { productModifierGroup: await createProductModifierGroup(database, principal, body) };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        productId: t.String({ format: "uuid" }),
        modifierGroupId: t.String({ format: "uuid" }),
        sortOrder: t.Optional(t.Integer({ minimum: 0, maximum: 999 }))
      })
    })
    .delete("/api/catalog/product-modifier-groups", async ({ request, query }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, query.storeId, "catalog.manage");
      try {
        await deleteProductModifierGroup(database, principal, query.productId, query.modifierGroupId);
        return { ok: true };
      } catch (error) {
        return rethrowCatalogError(error);
      }
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        productId: t.String({ format: "uuid" }),
        modifierGroupId: t.String({ format: "uuid" })
      })
    })
    // Store Core: Receipts Domain Endpoints
    .post("/api/receipts", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "order.create");
      try {
        const receipt = await createReceiptFromOrder(database, principal, {
          orderId: body.orderId,
          storeId: body.storeId,
          ...(body.cashReceivedMinor !== undefined ? { cashReceivedMinor: body.cashReceivedMinor } : {}),
          ...(body.cashierName ? { cashierName: body.cashierName } : {})
        });
        return { receipt };
      } catch (error) {
        throw new AppError(400, "RECEIPT_CREATION_FAILED", error instanceof Error ? error.message : "Failed to create receipt");
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        orderId: t.String({ format: "uuid" }),
        cashReceivedMinor: t.Optional(t.Integer({ minimum: 0 })),
        cashierName: t.Optional(t.String())
      })
    })
    .get("/api/receipts/:id", async ({ request, params, query }) => {
      const principal = await authenticate(request);
      if (!hasPermission(principal, "order.read")) throw forbidden();
      const receipt = await getReceiptById(database, principal, params.id);
      if (!receipt) throw new AppError(404, "RECEIPT_NOT_FOUND", "Receipt not found");
      if (!await canAccessStore(database, principal, receipt.storeId)) throw forbidden();
      if (query.format === "thermal") {
        return { receipt, thermalText: formatReceiptThermalText(receipt, 80) };
      }
      return { receipt };
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      query: t.Object({ format: t.Optional(t.String()) })
    })
    .get("/api/orders/:orderId/receipt", async ({ request, params, query }) => {
      const principal = await authenticateStore(request, query.storeId, "order.read");
      const receipt = await getReceiptByOrderId(database, principal, params.orderId);
      if (!receipt) throw new AppError(404, "RECEIPT_NOT_FOUND", "Receipt not found for this order");
      if (receipt.storeId !== query.storeId) throw forbidden();
      if (query.format === "thermal") {
        return { receipt, thermalText: formatReceiptThermalText(receipt, 80) };
      }
      return { receipt };
    }, {
      params: t.Object({ orderId: t.String({ format: "uuid" }) }),
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        format: t.Optional(t.String())
      })
    })
    .post("/api/receipts/:id/reprint", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "order.create");
      try {
        const receipt = await reprintReceipt(database, principal, params.id, body.storeId);
        return { receipt, thermalText: formatReceiptThermalText(receipt, 80) };
      } catch (error) {
        throw new AppError(400, "REPRINT_FAILED", error instanceof Error ? error.message : "Failed to reprint receipt");
      }
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .post("/api/receipts/:id/void", async ({ request, params, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "order.void");
      try {
        const receipt = await voidReceipt(database, principal, params.id, body.reason, body.storeId);
        return { receipt };
      } catch (error) {
        throw new AppError(400, "VOID_FAILED", error instanceof Error ? error.message : "Failed to void receipt");
      }
    }, {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        reason: t.String({ minLength: 1, maxLength: 500 })
      })
    })
    // Store Core: Cash Sessions Domain Endpoints
    .get("/api/cash-sessions/current", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "store.read");
      const session = await getCurrentCashSession(database, principal, query.storeId);
      return { session };
    }, {
      query: t.Object({ storeId: t.String({ format: "uuid" }) })
    })
    .post("/api/cash-sessions/open", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "cash_drawer.open");
      try {
        const session = await openCashSession(database, principal, {
          storeId: body.storeId,
          openingAmountMinor: body.openingAmountMinor,
          ...(body.notes ? { notes: body.notes } : {})
        });
        return { session };
      } catch (error) {
        throw new AppError(400, "CASH_SESSION_OPEN_FAILED", error instanceof Error ? error.message : "Failed to open cash session");
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        openingAmountMinor: t.Integer({ minimum: 0 }),
        notes: t.Optional(t.String({ maxLength: 500 }))
      })
    })
    .post("/api/cash-sessions/movement", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "cash_drawer.open");
      try {
        const movement = await recordCashMovement(database, principal, {
          cashSessionId: body.cashSessionId,
          storeId: body.storeId,
          movementType: body.movementType,
          amountMinor: body.amountMinor,
          reason: body.reason
        });
        return { movement };
      } catch (error) {
        throw new AppError(400, "CASH_MOVEMENT_FAILED", error instanceof Error ? error.message : "Failed to record cash movement");
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        cashSessionId: t.String({ format: "uuid" }),
        movementType: t.Union([t.Literal("IN"), t.Literal("OUT"), t.Literal("PAID_IN"), t.Literal("PAID_OUT")]),
        amountMinor: t.Integer({ minimum: 1 }),
        reason: t.String({ minLength: 1, maxLength: 500 })
      })
    })
    .post("/api/cash-sessions/close", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "cash_drawer.open");
      try {
        const session = await closeCashSession(database, principal, {
          cashSessionId: body.cashSessionId,
          storeId: body.storeId,
          countedAmountMinor: body.countedAmountMinor,
          ...(body.notes ? { notes: body.notes } : {})
        });
        return { session };
      } catch (error) {
        throw new AppError(400, "CASH_SESSION_CLOSE_FAILED", error instanceof Error ? error.message : "Failed to close cash session");
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        cashSessionId: t.String({ format: "uuid" }),
        countedAmountMinor: t.Integer({ minimum: 0 }),
        notes: t.Optional(t.String({ maxLength: 500 }))
      })
    })
    .get("/api/cash-sessions/history", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "store.read");
      const sessions = await listCashSessions(database, principal, query.storeId, query.limit ? Number(query.limit) : 20);
      return { sessions };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        limit: t.Optional(t.String())
      })
    })
    // Store Core: Daily Closing Endpoints
    .post("/api/reports/closing/daily", async ({ request, body }) => {
      assertAllowedOrigin(request);
      const principal = await authenticateStore(request, body.storeId, "store.manage");
      try {
        const closing = await createDailyClosing(database, principal, {
          storeId: body.storeId,
          closingDate: body.closingDate
        });
        return { closing };
      } catch (error) {
        throw new AppError(400, "DAILY_CLOSING_FAILED", error instanceof Error ? error.message : "Failed to generate daily closing");
      }
    }, {
      body: t.Object({
        storeId: t.String({ format: "uuid" }),
        closingDate: t.String({ minLength: 10, maxLength: 10 })
      })
    })
    .get("/api/reports/closing/daily", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "store.read");
      const closing = await getDailyClosing(database, principal, query.storeId, query.date);
      return { closing };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        date: t.String({ minLength: 10, maxLength: 10 })
      })
    })
    .get("/api/reports/closing/history", async ({ request, query }) => {
      const principal = await authenticateStore(request, query.storeId, "store.read");
      const closings = await listDailyClosings(database, principal, query.storeId, query.limit ? Number(query.limit) : 30);
      return { closings };
    }, {
      query: t.Object({
        storeId: t.String({ format: "uuid" }),
        limit: t.Optional(t.String())
      })
    });
}
