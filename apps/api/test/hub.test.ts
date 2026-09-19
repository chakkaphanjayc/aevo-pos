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
  permissions: ["organization.manage", "store.read", "store.manage"]
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

describe("Aevo Hub API endpoints", () => {
  const fakeDatabase: any = {
    ping: async () => undefined,
    close: async () => undefined,
    client: {
      from: (table: string) => {
        if (table === "apps") {
          return {
            select: () => ({
              order: async () => ({
                data: [
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
                ],
                error: null
              })
            })
          };
        }

        if (table === "app_subscriptions") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "sub-pos",
                      organization_id: "org-1",
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
                  ],
                  error: null
                })
              })
            }),
            upsert: (payload: any) => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: "sub-trial-1",
                    ...payload,
                    created_at: "2026-09-17T00:00:00Z",
                    updated_at: "2026-09-17T00:00:00Z"
                  },
                  error: null
                })
              })
            })
          };
        }

        if (table === "audit_logs") {
          return {
            insert: async () => ({ error: null })
          };
        }

        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
        };
      }
    }
  };

  const app = createApp({ config, database: fakeDatabase, auth: fakeAuth });

  test("GET /api/hub/apps returns ecosystem apps catalog", async () => {
    const response = await app.handle(new Request("http://localhost/api/hub/apps"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.apps).toBeDefined();
    expect(body.apps.length).toBe(2);
    expect(body.apps[0].id).toBe("pos");
    expect(body.apps[1].id).toBe("booking");
  });

  test("GET /api/hub/subscriptions requires authentication", async () => {
    const unauthResponse = await app.handle(new Request("http://localhost/api/hub/subscriptions"));
    expect(unauthResponse.status).toBe(401);

    const authResponse = await app.handle(new Request("http://localhost/api/hub/subscriptions", {
      headers: { cookie: cookieHeader() }
    }));
    expect(authResponse.status).toBe(200);
    const body = await authResponse.json();
    expect(body.subscriptions).toBeDefined();
    expect(body.subscriptions[0].appId).toBe("pos");
    expect(body.subscriptions[0].isEntitled).toBe(true);
  });

  test("POST /api/hub/subscriptions/trial activates a trial", async () => {
    const response = await app.handle(new Request("http://localhost/api/hub/subscriptions/trial", {
      method: "POST",
      headers: {
        cookie: cookieHeader(),
        origin: "http://localhost:4321",
        "content-type": "application/json"
      },
      body: JSON.stringify({ appId: "booking" })
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subscription).toBeDefined();
    expect(body.subscription.appId).toBe("booking");
    expect(body.subscription.status).toBe("TRIAL");
    expect(body.subscription.isEntitled).toBe(true);
  });
});
