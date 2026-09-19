import { describe, expect, test } from "bun:test";
import type { AppConfig } from "@aevo/config";
import { permissions, type SessionPrincipal } from "@aevo/contracts";
import { createApp } from "../src/app";
import { encodeAuthSessionCookie } from "../src/http";

const config: AppConfig = {
  nodeEnv: "test",
  apiHost: "127.0.0.1",
  apiPort: 3001,
  webOrigin: "http://localhost:4321",
  supabaseUrl: "https://demo.supabase.co",
  supabaseKey: "server-secret",
  sessionCookieName: "aevo_session",
  sessionCookieSameSite: "lax",
  logLevel: "error"
};

const mockOrgId = "00000000-0000-4000-8000-000000000001";
const mockStoreId = "00000000-0000-4000-8000-000000000010";
const mockUserId = "00000000-0000-4000-8000-000000000100";
const mockRoleId = "00000000-0000-4000-8000-000000000200";
const mockDeviceId = "00000000-0000-4000-8000-000000000500";

const principal: SessionPrincipal = {
  userId: mockUserId,
  email: "owner@example.com",
  displayName: "Aevo Owner",
  organizationId: mockOrgId,
  membershipId: "00000000-0000-4000-8000-000000000150",
  role: "OWNER",
  permissions: [...permissions]
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

async function sha256Hex(val: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(val));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const mockOrg = {
  id: mockOrgId,
  name: "Aevo Corporation",
  slug: "aevo-corp",
  status: "ACTIVE",
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T00:00:00Z"
};

const mockStore = {
  id: mockStoreId,
  organization_id: mockOrgId,
  name: "Aevo Flagship",
  code: "BKK-01",
  timezone: "Asia/Bangkok",
  status: "ACTIVE",
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T00:00:00Z"
};

const mockApps = [
  {
    id: "pos",
    name: "Aevo POS",
    description: "Point of Sale",
    icon: "pos",
    pricing_model: "PER_BRANCH",
    base_price_monthly_minor: 49900,
    status: "ACTIVE",
    features: ["Checkout", "KDS"],
    created_at: "2026-09-17T00:00:00Z"
  },
  {
    id: "booking",
    name: "Aevo Booking",
    description: "Sports & Resource Booking",
    icon: "booking",
    pricing_model: "PER_VENUE",
    base_price_monthly_minor: 59900,
    status: "ACTIVE",
    features: ["Time slots", "LINE Notify"],
    created_at: "2026-09-17T00:00:00Z"
  }
];

const mockSubscriptions = [
  {
    id: "sub-pos",
    organization_id: mockOrgId,
    store_id: null,
    app_id: "pos",
    status: "ACTIVE",
    plan_code: "STANDARD",
    trial_ends_at: null,
    current_period_starts_at: "2026-01-01T00:00:00Z",
    current_period_ends_at: "2030-01-01T00:00:00Z",
    grace_period_ends_at: "2030-01-15T00:00:00Z",
    device_limit: null,
    resource_limit: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z"
  }
];

class FluentQuery {
  private rows: any[];
  constructor(rows: any[]) {
    this.rows = rows;
  }
  select(_cols?: any, _opts?: any) {
    return this;
  }
  eq(col: string, val: any) {
    return new FluentQuery(this.rows.filter((r) => r[col] === val || r[col] === undefined));
  }
  neq(col: string, val: any) {
    return new FluentQuery(this.rows.filter((r) => r[col] !== val));
  }
  in(col: string, vals: any[]) {
    return new FluentQuery(this.rows.filter((r) => vals.includes(r[col]) || r[col] === undefined));
  }
  gte(col: string, val: any) {
    return new FluentQuery(this.rows.filter((r) => r[col] == null || r[col] >= val));
  }
  lte(col: string, val: any) {
    return new FluentQuery(this.rows.filter((r) => r[col] == null || r[col] <= val));
  }
  gt(col: string, val: any) {
    return new FluentQuery(this.rows.filter((r) => r[col] == null || r[col] > val));
  }
  lt(col: string, val: any) {
    return new FluentQuery(this.rows.filter((r) => r[col] == null || r[col] < val));
  }
  is(col: string, val: any) {
    return new FluentQuery(this.rows.filter((r) => r[col] === val));
  }
  order() {
    return this;
  }
  limit(n: number) {
    return new FluentQuery(this.rows.slice(0, n));
  }
  then(resolve: any) {
    resolve({ data: this.rows, error: null, count: this.rows.length });
  }
  async single() {
    const item = this.rows[0];
    return { data: item ?? null, error: item ? null : { message: "Row not found" } };
  }
  async maybeSingle() {
    return { data: this.rows[0] ?? null, error: null };
  }
  async count() {
    return { count: this.rows.length, error: null };
  }
}

async function createTestDatabase(): Promise<any> {
  const deviceTokenHash = await sha256Hex("test-device-token-12345");

  const tableData: Record<string, any[]> = {
    organizations: [mockOrg],
    memberships: [
      {
        id: "mem-1",
        organization_id: mockOrgId,
        user_id: mockUserId,
        role_id: mockRoleId,
        status: "ACTIVE",
        created_at: "2026-09-17T00:00:00Z"
      }
    ],
    roles: [
      { id: mockRoleId, code: "OWNER", name: "Owner" }
    ],
    stores: [mockStore],
    apps: mockApps,
    app_subscriptions: mockSubscriptions,
    cash_sessions: [
      {
        id: "00000000-0000-4000-8000-000000000300",
        organization_id: mockOrgId,
        store_id: mockStoreId,
        opened_by: mockUserId,
        opening_amount_minor: 100000,
        status: "OPEN",
        opened_at: "2026-09-17T08:00:00Z"
      }
    ],
    venues: [
      {
        id: "00000000-0000-4000-8000-000000000400",
        organization_id: mockOrgId,
        name: "Aevo Arena",
        slug: "aevo-arena"
      }
    ],
    devices: [
      {
        id: mockDeviceId,
        organization_id: mockOrgId,
        store_id: mockStoreId,
        name: "KDS Kitchen 1",
        device_type: "KDS",
        device_token_hash: deviceTokenHash,
        status: "ACTIVE",
        created_at: "2026-09-17T00:00:00Z"
      }
    ],
    audit_logs: [],
    orders: [],
    queue_tickets: [],
    preparation_stations: [],
    preparation_tasks: []
  };

  return {
    ping: async () => undefined,
    close: async () => undefined,
    client: {
      from: (table: string) => {
        const rows = tableData[table] ?? [];
        const query = new FluentQuery(rows);

        return Object.assign(query, {
          insert: (payload: any) => {
            const newItem = {
              id: crypto.randomUUID(),
              ...(Array.isArray(payload) ? payload[0] : payload),
              created_at: "2026-09-17T00:00:00Z",
              updated_at: "2026-09-17T00:00:00Z"
            };
            rows.push(newItem);
            return {
              select: () => ({
                single: async () => ({ data: newItem, error: null })
              }),
              then: (resolve: any) => resolve({ data: [newItem], error: null })
            };
          },
          update: (_payload: any) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "updated" }, error: null })
                }),
                maybeSingle: async () => ({ data: { id: "updated" }, error: null }),
                then: (resolve: any) => resolve({ data: [], error: null })
              }),
              select: () => ({
                maybeSingle: async () => ({ data: { id: "updated" }, error: null })
              }),
              maybeSingle: async () => ({ data: { id: "updated" }, error: null }),
              then: (resolve: any) => resolve({ data: [], error: null })
            })
          }),
          upsert: (payload: any) => {
            const newItem = {
              id: crypto.randomUUID(),
              ...(Array.isArray(payload) ? payload[0] : payload),
              created_at: "2026-09-17T00:00:00Z",
              updated_at: "2026-09-17T00:00:00Z"
            };
            rows.push(newItem);
            return {
              select: () => ({
                single: async () => ({ data: newItem, error: null })
              })
            };
          }
        });
      }
    }
  };
}

describe("Aevo Canonical API Gateway (v1)", () => {
  let app: any;

  test("Bootstrap test application", async () => {
    const fakeDatabase = await createTestDatabase();
    app = createApp({ config, database: fakeDatabase, auth: fakeAuth });
    expect(app).toBeDefined();
  });

  describe("Surface 1: /api/v1/hub/*", () => {
    test("GET /api/v1/hub/apps returns full apps catalog", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/apps"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.apps).toBeDefined();
      expect(body.apps.length).toBe(2);
      expect(body.apps[0].id).toBe("pos");
    });

    test("GET /api/v1/hub/subscriptions enforces auth and returns entitled status", async () => {
      const unauth = await app.handle(new Request("http://localhost/api/v1/hub/subscriptions"));
      expect(unauth.status).toBe(401);

      const auth = await app.handle(new Request("http://localhost/api/v1/hub/subscriptions", {
        headers: { cookie: cookieHeader() }
      }));
      expect(auth.status).toBe(200);
      const body = await auth.json();
      expect(body.subscriptions).toBeDefined();
      expect(body.subscriptions[0].appId).toBe("pos");
      expect(body.subscriptions[0].isEntitled).toBe(true);
    });

    test("GET /api/v1/hub/entitlements/pos checks app entitlement", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/entitlements/pos", {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entitlement).toBeDefined();
      expect(body.entitlement.appId).toBe("pos");
      expect(body.entitlement.isEntitled).toBe(true);
    });

    test("POST /api/v1/hub/subscriptions/trial creates 14-day trial", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/subscriptions/trial", {
        method: "POST",
        headers: {
          cookie: cookieHeader(),
          origin: "http://localhost:4321",
          "content-type": "application/json"
        },
        body: JSON.stringify({ appId: "booking" })
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.subscription.appId).toBe("booking");
      expect(body.subscription.status).toBe("TRIAL");
    });

    test("GET /api/v1/hub/organizations returns organizations list", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/organizations", {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.organizations).toBeDefined();
      expect(body.organizations[0].name).toBe("Aevo Corporation");
    });

    test("POST /api/v1/hub/organizations creates new organization", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/organizations", {
        method: "POST",
        headers: {
          cookie: cookieHeader(),
          origin: "http://localhost:4321",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Aevo New Corp", slug: "aevo-new" })
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.organization).toBeDefined();
      expect(body.organization.name).toBe("Aevo New Corp");
    });

    test("GET /api/v1/hub/stores returns stores list", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/stores", {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stores).toBeDefined();
      expect(body.stores[0].code).toBe("BKK-01");
    });

    test("POST /api/v1/hub/stores creates new store", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/stores", {
        method: "POST",
        headers: {
          cookie: cookieHeader(),
          origin: "http://localhost:4321",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Aevo Chiang Mai", code: "CNX-01" })
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.store).toBeDefined();
      expect(body.store.code).toBe("CNX-01");
    });

    test("GET /api/v1/hub/stats returns platform statistics", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/stats", {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stats).toBeDefined();
      expect(body.stats.totalApps).toBeGreaterThanOrEqual(2);
    });

    test("GET /api/v1/hub/audit-logs returns audit log list", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/hub/audit-logs?limit=10", {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logs).toBeDefined();
    });
  });

  describe("Surface 2: /api/v1/staff/*", () => {
    test("GET /api/v1/staff/context returns principal and stores", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/staff/context", {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.principal).toBeDefined();
      expect(body.principal.email).toBe("owner@example.com");
      expect(body.stores).toBeDefined();
      expect(body.stores.length).toBeGreaterThan(0);
    });

    test("GET /api/v1/staff/orders lists orders for store", async () => {
      const res = await app.handle(new Request(`http://localhost/api/v1/staff/orders?storeId=${mockStoreId}`, {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.orders).toBeDefined();
    });

    test("GET /api/v1/staff/cash-sessions/current returns current session with UUID storeId", async () => {
      const res = await app.handle(new Request(`http://localhost/api/v1/staff/cash-sessions/current?storeId=${mockStoreId}`, {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.session).toBeDefined();
      expect(body.session.status).toBe("OPEN");
    });

    test("GET /api/v1/staff/queue/tickets returns queue tickets", async () => {
      const res = await app.handle(new Request(`http://localhost/api/v1/staff/queue/tickets?storeId=${mockStoreId}`, {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tickets).toBeDefined();
    });

    test("GET /api/v1/staff/preparation/tasks returns KDS tasks", async () => {
      const res = await app.handle(new Request(`http://localhost/api/v1/staff/preparation/tasks?storeId=${mockStoreId}`, {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tasks).toBeDefined();
    });

    test("GET /api/v1/staff/devices returns devices list", async () => {
      const res = await app.handle(new Request(`http://localhost/api/v1/staff/devices?storeId=${mockStoreId}`, {
        headers: { cookie: cookieHeader() }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.devices).toBeDefined();
      expect(body.devices.length).toBeGreaterThan(0);
    });
  });

  describe("Surface 3: /api/v1/public/*", () => {
    test("GET /api/v1/public/venues/aevo-arena/availability returns availability slots", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/public/venues/aevo-arena/availability?date=2026-09-17"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.date).toBe("2026-09-17");
      expect(body.slots).toBeDefined();
    });

    test("GET /api/v1/public/queue/BKK-01/snapshot returns queue snapshot", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/public/queue/BKK-01/snapshot"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.snapshot).toBeDefined();
      expect(body.snapshot.store.code).toBe("BKK-01");
      expect(body.snapshot.preparing).toBeDefined();
      expect(body.snapshot.ready).toBeDefined();
    });
  });

  describe("Surface 4: /api/v1/device/*", () => {
    test("POST /api/v1/device/pair rejects missing pairing code", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/device/pair", {
        method: "POST",
        headers: {
          origin: "http://localhost:4321",
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      }));
      expect(res.status).toBe(422);
    });

    test("GET /api/v1/device/context rejects unauthenticated device", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/device/context"));
      expect(res.status).toBe(401);
    });

    test("GET /api/v1/device/context accepts valid device token and returns device info", async () => {
      const res = await app.handle(new Request("http://localhost/api/v1/device/context", {
        headers: {
          "x-device-token": "test-device-token-12345"
        }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.device).toBeDefined();
      expect(body.device.id).toBe(mockDeviceId);
      expect(body.store).toBeDefined();
      expect(body.store.code).toBe("BKK-01");
    });
  });
});
