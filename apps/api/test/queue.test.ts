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
  email: "owner@example.com",
  displayName: "Aevo Owner",
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

describe("Queue API endpoints", () => {
  const storeId = "00000000-0000-4000-8000-000000000001";
  const ticketId = "00000000-0000-4000-8000-000000000010";

  const mockStore = { id: storeId, organization_id: "org-1", code: "MAIN", name: "Main Cafe", status: "ACTIVE" };
  const mockTicket1 = {
    id: ticketId,
    organization_id: "org-1",
    store_id: storeId,
    order_id: "order-1",
    queue_number: "Q-001",
    status: "WAITING",
    created_at: new Date().toISOString()
  };
  const mockTicket2 = {
    id: "00000000-0000-4000-8000-000000000020",
    organization_id: "org-1",
    store_id: storeId,
    order_id: "order-2",
    queue_number: "Q-002",
    status: "READY",
    called_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const fakeDatabase = {
    ping: async () => undefined,
    close: async () => undefined,
    client: {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: (col: string, val: string) => {
            chain._filters = chain._filters || {};
            chain._filters[col] = val;
            return chain;
          },
          gte: () => chain,
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
            if (table === "queue_tickets") return { data: mockTicket1, error: null };
            return { data: null, error: null };
          },
          single: async () => {
            if (table === "queue_tickets" && chain._patch) {
              return { data: { ...mockTicket1, ...chain._patch }, error: null };
            }
            if (table === "queue_tickets") return { data: mockTicket1, error: null };
            if (table === "stores") return { data: mockStore, error: null };
            return { data: null, error: null };
          },
          then: (resolve: any) => {
            if (table === "queue_tickets") {
              return Promise.resolve({ data: [mockTicket1, mockTicket2], error: null }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
        };
        return chain;
      }
    } as any
  } as unknown as Database;

  const app = createApp({ config, database: fakeDatabase, auth: fakeAuth });

  test("GET /api/public/queue/:storeCode returns queue display snapshot", async () => {
    const response = await app.handle(new Request("http://localhost/api/public/queue/MAIN"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.store.code).toBe("MAIN");
    expect(body.preparing).toBeArray();
    expect(body.preparing[0].queueNumber).toBe("Q-001");
    expect(body.ready).toBeArray();
    expect(body.ready[0].queueNumber).toBe("Q-002");
    expect(body.recentlyCalled?.queueNumber).toBe("Q-002");
  });

  test("GET /api/queue requires authentication and returns tickets", async () => {
    const unauthResponse = await app.handle(new Request(`http://localhost/api/queue?storeId=${storeId}`));
    expect(unauthResponse.status).toBe(401);

    const authResponse = await app.handle(
      new Request(`http://localhost/api/queue?storeId=${storeId}`, {
        headers: { cookie: cookieHeader() }
      })
    );
    expect(authResponse.status).toBe(200);
    const body = await authResponse.json();
    expect(body.tickets).toBeArray();
    expect(body.tickets[0].queueNumber).toBe("Q-001");
  });

  test("POST /api/queue/:ticketId/call calls the ticket and marks READY", async () => {
    const response = await app.handle(
      new Request(`http://localhost/api/queue/${ticketId}/call`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(),
          origin: "http://localhost:4321"
        }
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ticket.status).toBe("READY");
    expect(body.ticket.calledAt).toBeTruthy();
  });

  test("POST /api/queue/:ticketId/complete marks ticket COMPLETED", async () => {
    const response = await app.handle(
      new Request(`http://localhost/api/queue/${ticketId}/complete`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(),
          origin: "http://localhost:4321"
        }
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ticket.status).toBe("COMPLETED");
  });
});
