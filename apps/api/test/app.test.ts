import { expect, test, describe } from "bun:test";
import { createHmac } from "node:crypto";
import type { AppConfig } from "@aevo/config";
import type { SessionPrincipal } from "@aevo/contracts";
import type { Database } from "@aevo/db";
import { createApp } from "../src/app";
import { encodeAuthSessionCookie } from "../src/http";
import { POS_TEST_STORE_ID, POS_TEST_USER_ID } from "../src/test-mode";

const config: AppConfig = {
  nodeEnv: "test", apiHost: "127.0.0.1", apiPort: 3001, webOrigin: "http://localhost:4332",
  supabaseUrl: "https://demo.supabase.co", supabaseKey: "server-secret",
  sessionCookieName: "aevo_session", sessionCookieSameSite: "lax", logLevel: "error"
};

const fakeDatabase = { ping: async () => undefined, close: async () => undefined } as unknown as Database;
const principal: SessionPrincipal = {
  userId: "user-1", email: "owner@example.com", displayName: "Aevo Owner",
  organizationId: "org-1", membershipId: "membership-1", role: "OWNER",
  permissions: ["store.read"]
};
const fakeAuth = {
  login: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  refresh: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  logout: async () => undefined,
  resolve: async (token: string) => token === "secret" ? principal : null
};

function cookieHeader() {
  return `aevo_session=${encodeURIComponent(encodeAuthSessionCookie({ accessToken: "secret", refreshToken: "refresh" }))}`;
}

describe("API foundation", () => {
  const app = createApp({ config, database: fakeDatabase, auth: fakeAuth });

  test("health includes a correlation id", async () => {
    const response = await app.handle(new Request("http://localhost/health", { headers: { "x-request-id": "request-123" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(await response.json()).toMatchObject({ status: "ok", requestId: "request-123" });
  });

  test("protected routes reject anonymous callers", async () => {
    const response = await app.handle(new Request("http://localhost/api/auth/me"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  test("readiness checks Supabase connectivity", async () => {
    const response = await app.handle(new Request("http://localhost/ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready" });
  });

  test("requires a signed compatibility handshake", async () => {
    const handshakeApp = createApp({
      config: { ...config, handshakeSecret: "handshake-secret" },
      database: fakeDatabase,
      auth: fakeAuth
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "0123456789abcdef0123456789abcdef";
    const signature = createHmac("sha256", "handshake-secret")
      .update([timestamp, "GET", "/.well-known/aevo-handshake", nonce, "POS"].join("\n"))
      .digest("hex");
    const unauthorized = await handshakeApp.handle(new Request("http://localhost/.well-known/aevo-handshake"));
    expect(unauthorized.status).toBe(401);
    const response = await handshakeApp.handle(new Request("http://localhost/.well-known/aevo-handshake", {
      headers: {
        "x-aevo-handshake-timestamp": timestamp,
        "x-aevo-handshake-nonce": nonce,
        "x-aevo-handshake-signature": signature
      }
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ protocol: "aevo.application-handshake", appCode: "POS", contractVersion: "v1", status: "ready" });
  });

  test("forwards a store context through the Accounts login start", async () => {
    const ssoApp = createApp({
      config: {
        ...config,
        accountsApiOrigin: "https://accounts.test",
        modernWebOrigin: "https://pos.test"
      },
      database: fakeDatabase,
      auth: fakeAuth
    });
    const storeId = "00000000-0000-4000-8000-000000000010";
    const response = await ssoApp.handle(new Request(`http://localhost/api/auth/start?returnTo=%2F&storeId=${storeId}`));
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("store_id")).toBe(storeId);
  });

  test("login writes an http-only cookie containing Supabase tokens", async () => {
    const response = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "correct-password" })
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain(encodeURIComponent("accessToken"));
  });

  test("authenticated session can be resolved and logged out", async () => {
    const me = await app.handle(new Request("http://localhost/api/auth/me", { headers: { cookie: cookieHeader() } }));
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: principal });

    const logout = await app.handle(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { cookie: cookieHeader() }
    }));
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("refresh rotates the Supabase session cookie", async () => {
    const response = await app.handle(new Request("http://localhost/api/auth/refresh", {
      method: "POST", headers: { cookie: cookieHeader(), origin: config.webOrigin }
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  test("rejects credentialed mutations from an untrusted origin", async () => {
    const response = await app.handle(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { origin: "https://attacker.example" }
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });
  });

  test("catalog routes require the catalog permission", async () => {
    const response = await app.handle(new Request("http://localhost/api/catalog?storeId=00000000-0000-4000-8000-000000000011", {
      headers: { cookie: cookieHeader() }
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  test("catalog mutations reject cross-site origins", async () => {
    const response = await app.handle(new Request("http://localhost/api/catalog/products", {
      method: "POST",
      headers: {
        cookie: cookieHeader(),
        origin: "https://attacker.example",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        storeId: "00000000-0000-4000-8000-000000000011",
        sku: "LATTE",
        name: "Latte",
        basePriceMinor: 6500
      })
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });
  });

  test("catalog PATCH is advertised in CORS preflight", async () => {
    const response = await app.handle(new Request("http://localhost/api/catalog/products/product/availability", {
      method: "OPTIONS",
      headers: {
        origin: config.webOrigin,
        "access-control-request-method": "PATCH"
      }
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(response.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  test("product-modifier-groups requires catalog permission", async () => {
    const response = await app.handle(new Request("http://localhost/api/catalog/product-modifier-groups", {
      method: "POST",
      headers: {
        cookie: cookieHeader(),
        origin: config.webOrigin,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        storeId: "00000000-0000-4000-8000-000000000011",
        productId: "00000000-0000-4000-8000-000000000022",
        modifierGroupId: "00000000-0000-4000-8000-000000000033"
      })
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

describe("POS test mode", () => {
  const testConfig: AppConfig = { ...config, testMode: true };
  const testApp = createApp({ config: testConfig, database: fakeDatabase, auth: fakeAuth });

  test("opens the POS without a cookie and returns a demo store", async () => {
    const me = await testApp.handle(new Request("http://localhost/api/auth/me"));
    expect(me.status).toBe(200);
    expect((await me.json()).user.userId).toBe(POS_TEST_USER_ID);

    const stores = await testApp.handle(new Request("http://localhost/api/stores"));
    expect(stores.status).toBe(200);
    expect((await stores.json()).stores[0].id).toBe(POS_TEST_STORE_ID);
  });

  test("serves catalog and keeps order/payment state in memory", async () => {
    const catalog = await testApp.handle(new Request(`http://localhost/api/v1/staff/catalog?storeId=${POS_TEST_STORE_ID}`));
    expect(catalog.status).toBe(200);
    const product = (await catalog.json()).products[0];

    const create = await testApp.handle(new Request("http://localhost/api/v1/staff/orders", {
      method: "POST",
      headers: { "content-type": "application/json", origin: testConfig.webOrigin },
      body: JSON.stringify({
        storeId: POS_TEST_STORE_ID,
        channel: "POS",
        orderType: "POS",
        fulfillmentType: "TAKEAWAY",
        currency: "THB",
        items: [{ productId: product.id, quantity: 1 }]
      })
    }));
    expect(create.status).toBe(200);
    const created = (await create.json()).order;
    expect(created.status).toBe("PENDING_PAYMENT");

    const pay = await testApp.handle(new Request(`http://localhost/api/v1/staff/orders/${created.id}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: testConfig.webOrigin },
      body: JSON.stringify({ storeId: POS_TEST_STORE_ID, method: "CASH", amountMinor: created.totalMinor, currency: "THB" })
    }));
    expect(pay.status).toBe(200);
    expect((await pay.json()).order.status).toBe("PAID");
  });
});
