import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";

describe("Receipts and Cash Sessions API endpoints", () => {
  const config = {
    appName: "aevo-test",
    apiPrefix: "/api",
    sessionCookieName: "aevo_session",
    sessionSecret: "test-secret-must-be-at-least-32-chars-long",
    sessionTtlSeconds: 86400,
    webOrigin: "http://localhost:3000",
    authRateLimitWindowMs: 60000,
    authRateLimitMaxRequests: 100,
    databasePoolSize: 10
  };

  it("handles receipt reprint endpoint with valid store authentication", async () => {
    const mockReceipt = {
      id: "00000000-0000-0000-0000-000000000001",
      organization_id: "00000000-0000-0000-0000-000000000010",
      store_id: "00000000-0000-0000-0000-000000000100",
      order_id: "00000000-0000-0000-0000-000000001000",
      receipt_number: "RCP-20260917-0001",
      order_number: "0001",
      store_snapshot: { name: "Test Cafe", code: "TC-01" },
      items_snapshot: [],
      subtotal_minor: 10000,
      discount_minor: 0,
      tax_minor: 700,
      total_minor: 10000,
      payments_summary: [],
      reprint_count: 0,
      is_void: false,
      created_at: new Date().toISOString()
    };

    const mockStore = {
      id: "00000000-0000-0000-0000-000000000100",
      organization_id: "00000000-0000-0000-0000-000000000010",
      status: "ACTIVE"
    };

    const mockDb = {
      client: {
        from: (table: string) => {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            gte: () => chain,
            lte: () => chain,
            order: () => chain,
            limit: () => chain,
            update: () => chain,
            single: async () => {
              if (table === "receipts") return { data: { ...mockReceipt, reprint_count: 1 }, error: null };
              return { data: null, error: null };
            },
            maybeSingle: async () => {
              if (table === "receipts") return { data: mockReceipt, error: null };
              if (table === "stores") return { data: mockStore, error: null };
              return { data: null, error: null };
            }
          };
          return chain;
        }
      }
    };

    const mockAuth = {
      resolve: async () => ({
        userId: "user-1",
        email: "staff@test.com",
        organizationId: "00000000-0000-0000-0000-000000000010",
        membershipId: "m-1",
        role: "OWNER" as const,
        permissions: ["order.create", "store.read", "order.read"] as any[]
      }),
      login: async () => ({} as any),
      logout: async () => {},
      refresh: async () => ({} as any)
    };

    const app = createApp({
      config: config as any,
      database: mockDb as any,
      auth: mockAuth as any
    });

    // Test GET /api/receipts/:id?format=thermal
    const res = await app.handle(
      new Request("http://localhost/api/receipts/00000000-0000-0000-0000-000000000001?format=thermal", {
        headers: {
          cookie: "aevo_session=valid-session",
          origin: "http://localhost:3000"
        }
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt).toBeDefined();
    expect(body.thermalText).toContain("RCP-20260917-0001");
  });
});
