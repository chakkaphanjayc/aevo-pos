import { randomUUID } from "node:crypto";
import { AuthenticationError, AuthService, hasPermission } from "@aevo/auth";
import type { AppConfig } from "@aevo/config";
import type { Permission, SessionPrincipal } from "@aevo/contracts";
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
  getOrder,
  getPublicCatalog,
  listOrders,
  OrderConflictError,
  OrderNotFoundError,
  OrderValidationError,
  recordOrderPayment,
  transitionOrder,
  updateProduct,
  updateProductAvailability
} from "@aevo/db";
import { InvalidOrderTransitionError } from "@aevo/ordering";
import { createStoreRoomBroadcaster, type RealtimeEventName, type RealtimePayloadMap } from "@aevo/realtime";
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

  function idempotencyKey(request: Request): string {
    return request.headers.get("idempotency-key")?.trim() ?? "";
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
      set.headers["access-control-allow-headers"] = "accept,content-type,x-organization-id,x-request-id,idempotency-key";
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
        return { order };
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
        return { order };
      } catch (error) {
        return rethrowOrderError(error);
      }
    }, {
      body: t.Object({
        storeCode: t.String({ minLength: 1, maxLength: 32 }),
        channel: t.Literal("QR"),
        fulfillmentType: t.Union([t.Literal("TAKEAWAY"), t.Literal("DINE_IN")]),
        tableNumber: t.Optional(t.String({ maxLength: 32 })),
        customerName: t.Optional(t.String({ maxLength: 160 })),
        customerPhone: t.Optional(t.String({ maxLength: 40 })),
        notes: t.Optional(t.String({ maxLength: 2000 })),
        items: t.Array(t.Object({
          productId: t.String({ format: "uuid" }),
          variantId: t.Optional(t.String({ format: "uuid" })),
          modifierIds: t.Optional(t.Array(t.String({ format: "uuid" }), { maxItems: 50 })),
          quantity: t.Integer({ minimum: 1, maximum: 999 }),
          note: t.Optional(t.String({ maxLength: 1000 }))
        }), { minItems: 1, maxItems: 100 })
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
    });
}
