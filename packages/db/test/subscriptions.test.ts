import { describe, expect, it } from "bun:test";
import type { SessionPrincipal } from "@aevo/contracts";
import {
  getAppEntitlement,
  listApps,
  listOrganizationSubscriptions,
  startAppTrial
} from "../src/subscriptions";

describe("subscriptions repository", () => {
  const principal: SessionPrincipal = {
    userId: "user-1",
    email: "owner@example.com",
    displayName: "Owner",
    organizationId: "org-1",
    membershipId: "membership-1",
    role: "OWNER",
    permissions: ["organization.manage", "store.read", "store.manage"]
  };

  it("lists available ecosystem apps", async () => {
    const mockDb: any = {
      client: {
        from: (table: string) => {
          expect(table).toBe("apps");
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
      }
    };

    const apps = await listApps(mockDb);
    expect(apps.length).toBe(2);
    expect(apps[0]?.id).toBe("pos");
    expect(apps[0]?.basePriceMonthlyMinor).toBe(49900);
    expect(apps[1]?.id).toBe("booking");
  });

  it("evaluates entitlement status accurately", async () => {
    const mockDb: any = {
      client: {
        from: (table: string) => {
          expect(table).toBe("app_subscriptions");
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
            })
          };
        }
      }
    };

    const posEntitlement = await getAppEntitlement(mockDb, principal, "pos");
    expect(posEntitlement.isEntitled).toBe(true);
    expect(posEntitlement.status).toBe("ACTIVE");
    expect(posEntitlement.features).toContain("pos.use");

    const bookingEntitlement = await getAppEntitlement(mockDb, principal, "booking");
    expect(bookingEntitlement.isEntitled).toBe(false);
    expect(bookingEntitlement.status).toBe("UNSUBSCRIBED");
    expect(bookingEntitlement.features).toEqual([]);
  });

  it("starts a 14-day app trial", async () => {
    let upsertPayload: any = null;
    const mockDb: any = {
      client: {
        from: (table: string) => {
          expect(table).toBe("app_subscriptions");
          return {
            upsert: (payload: any) => {
              upsertPayload = payload;
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: "sub-new-trial",
                      ...payload,
                      created_at: "2026-09-17T00:00:00Z",
                      updated_at: "2026-09-17T00:00:00Z"
                    },
                    error: null
                  })
                })
              };
            }
          };
        }
      }
    };

    const trial = await startAppTrial(mockDb, principal, { appId: "booking", storeId: "store-1" });
    expect(trial.appId).toBe("booking");
    expect(trial.status).toBe("TRIAL");
    expect(trial.isEntitled).toBe(true);
    expect(upsertPayload.status).toBe("TRIAL");
    expect(upsertPayload.trial_ends_at).toBeDefined();
  });
});
