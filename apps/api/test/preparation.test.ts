import { describe, expect, test } from "bun:test";
import type { AppConfig } from "@aevo/config";
import type { SessionPrincipal } from "@aevo/contracts";
import type { Database } from "@aevo/db";
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

const principal: SessionPrincipal = {
  userId: "user-1",
  email: "chef@example.com",
  displayName: "Head Chef",
  organizationId: "org-1",
  membershipId: "membership-1",
  role: "OWNER",
  permissions: ["store.read", "order.create"]
};

const fakeAuth = {
  login: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  refresh: async () => ({ accessToken: "secret", refreshToken: "refresh", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  logout: async () => undefined,
  resolve: async (token: string) => (token === "secret" ? principal : null)
};

function cookieHeader() {
  return `aevo_session=${encodeURIComponent(encodeAuthSessionCookie({ accessToken: "secret", refreshToken: "refresh" }))}`;
}

describe("Preparation / KDS API endpoints", () => {
  const storeId = "00000000-0000-4000-8000-000000000001";
  const stationId = "00000000-0000-4000-8000-000000000010";
  const taskId = "00000000-0000-4000-8000-000000000100";

  const mockStore = { id: storeId, organization_id: "org-1", code: "MAIN", name: "Main Store", status: "ACTIVE" };
  const mockStation = {
    id: stationId,
    organization_id: "org-1",
    store_id: storeId,
    code: "BAR",
    name: "Bar Station",
    display_order: 1,
    status: "ACTIVE"
  };
  const mockTask = {
    id: taskId,
    organization_id: "org-1",
    store_id: storeId,
    order_id: "order-1",
    order_item_id: "item-1",
    station_id: stationId,
    status: "PENDING",
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    orders: { order_number: "SO-20260917-00001" },
    preparation_stations: { code: "BAR", name: "Bar Station" },
    order_items: {
      product_name: "Iced Latte",
      variant_name: "Large",
      quantity: 2,
      note: "Less sweet",
      order_item_modifiers: [{ modifier_name: "Oat Milk" }]
    }
  };

  const fakeDatabase = {
    ping: async () => undefined,
    close: async () => undefined,
    client: {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          update: (patch: any) => {
            chain._patch = patch;
            return chain;
          },
          maybeSingle: async () => {
            if (table === "stores") return { data: mockStore, error: null };
            if (table === "store_memberships") return { data: { store_id: storeId, membership_id: "membership-1" }, error: null };
            if (table === "queue_tickets") return { data: null, error: null };
            return { data: null, error: null };
          },
          single: async () => {
            if (table === "preparation_tasks" && chain._patch) {
              return { data: { ...mockTask, ...chain._patch }, error: null };
            }
            if (table === "stores") return { data: mockStore, error: null };
            return { data: null, error: null };
          },
          then: (resolve: any) => {
            if (table === "preparation_stations") {
              resolve({ data: [mockStation], error: null });
            } else if (table === "preparation_tasks") {
              resolve({ data: [mockTask], error: null });
            } else {
              resolve({ data: [], error: null });
            }
          }
        };
        return chain;
      }
    }
  } as unknown as Database;

  const app = createApp({ config, database: fakeDatabase, auth: fakeAuth });

  test("GET /api/preparation/stations returns stations for store", async () => {
    const res = await app.handle(
      new Request(`http://127.0.0.1:3001/api/preparation/stations?storeId=${storeId}`, {
        headers: { cookie: cookieHeader() }
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.stations).toBeArray();
    expect(body.stations[0].code).toBe("BAR");
  });

  test("GET /api/preparation/tasks returns tasks for station", async () => {
    const res = await app.handle(
      new Request(`http://127.0.0.1:3001/api/preparation/tasks?storeId=${storeId}&stationId=${stationId}`, {
        headers: { cookie: cookieHeader() }
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tasks).toBeArray();
    expect(body.tasks[0].productName).toBe("Iced Latte");
  });

  test("POST /api/preparation/tasks/:taskId/complete marks task as done", async () => {
    const res = await app.handle(
      new Request(`http://127.0.0.1:3001/api/preparation/tasks/${taskId}/complete`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(),
          origin: "http://localhost:4321"
        }
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.task).toBeDefined();
    expect(body.readiness).toBeDefined();
  });
});
