import { expect, test } from "bun:test";
import type { AppConfig } from "@aevo/config";
import type { Database } from "@aevo/db";
import type { SessionPrincipal } from "@aevo/contracts";
import { createApp } from "../src/app";
import { encodeAuthSessionCookie } from "../src/http";

type Row = Record<string, unknown>;

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  eq(field: string, value: unknown) { this.filters.push((row) => row[field] === value); return this; }
  maybeSingle() {
    const rows = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    return Promise.resolve({ data: rows[0] ?? null, error: rows.length > 1 ? { message: "multiple rows" } : null });
  }
}

const config: AppConfig = {
  nodeEnv: "test", apiHost: "127.0.0.1", apiPort: 3001, webOrigin: "http://localhost:4321",
  supabaseUrl: "https://demo.supabase.co", supabaseKey: "server-secret",
  sessionCookieName: "aevo_session", sessionCookieSameSite: "lax", logLevel: "error"
};
const principal: SessionPrincipal = {
  userId: "user-1", email: "owner@example.com", organizationId: "org-1", membershipId: "membership-1",
  role: "OWNER", permissions: ["store.read", "order.read", "order.create", "payment.receive"]
};
const store = { id: "00000000-0000-4000-8000-000000000011", organization_id: "org-1", status: "ACTIVE" };
const fakeAuth = {
  login: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  refresh: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  logout: async () => undefined,
  resolve: async () => principal
};

function database(): Database {
  return {
    client: { from: (table: string) => new Query(table === "stores" ? [store] : []) } as never,
    ping: async () => undefined,
    close: async () => undefined
  };
}

function cookie() {
  return `aevo_session=${encodeURIComponent(encodeAuthSessionCookie({ accessToken: "secret", refreshToken: "refresh" }))}`;
}

test("order creation refuses retries without an idempotency key", async () => {
  const app = createApp({ config, database: database(), auth: fakeAuth });
  const response = await app.handle(new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { cookie: cookie(), origin: config.webOrigin, "content-type": "application/json" },
    body: JSON.stringify({
      storeId: store.id, channel: "POS", fulfillmentType: "TAKEAWAY",
      items: [{ productId: "00000000-0000-4000-8000-000000000012", quantity: 1 }]
    })
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: "ORDER_VALIDATION_ERROR" } });
});

test("order transition rejects an impossible lifecycle jump", async () => {
  const app = createApp({ config, database: database(), auth: fakeAuth });
  const response = await app.handle(new Request("http://localhost/api/orders/00000000-0000-4000-8000-000000000013/transition", {
    method: "POST",
    headers: {
      cookie: cookie(), origin: config.webOrigin, "content-type": "application/json", "idempotency-key": "transition-key-2"
    },
    body: JSON.stringify({ storeId: store.id, expectedStatus: "PAID", toStatus: "READY" })
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: "INVALID_ORDER_TRANSITION" } });
});
