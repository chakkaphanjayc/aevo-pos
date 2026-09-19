import { describe, expect, it } from "bun:test";
import {
  getBillingCustomer,
  MockBillingAdapter,
  recordBillingCustomer,
  recordBillingWebhookEvent
} from "../src/billing";

describe("billing repository & adapter", () => {
  it("creates customer and subscription via MockBillingAdapter", async () => {
    const adapter = new MockBillingAdapter();
    const customer = await adapter.createCustomer({
      organizationId: "org-1",
      name: "Acme Cafe",
      email: "billing@acmecafe.com"
    });

    expect(customer.organizationId).toBe("org-1");
    expect(customer.provider).toBe("STRIPE");
    expect(customer.providerCustomerId).toBeDefined();

    const subscription = await adapter.createSubscription({
      organizationId: "org-1",
      customerId: customer.providerCustomerId,
      appId: "pos",
      planCode: "BUSINESS"
    });

    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.planCode).toBe("BUSINESS");

    const portalUrl = await adapter.getPortalUrl(customer.providerCustomerId, "https://app.aevo.co/staff/hub");
    expect(portalUrl).toContain("billing.stripe.com");

    const changed = await adapter.changePlan({
      subscriptionId: subscription.providerSubscriptionId,
      newPlanCode: "ENTERPRISE"
    });
    expect(changed.planCode).toBe("ENTERPRISE");

    await adapter.cancelSubscription(subscription.providerSubscriptionId);
  });

  it("records billing customer and checks webhook idempotency in database", async () => {
    let upsertPayload: any = null;
    let insertedWebhook: any = null;

    const mockDb: any = {
      client: {
        from: (table: string) => {
          if (table === "billing_customers") {
            return {
              upsert: (payload: any) => {
                upsertPayload = payload;
                return {
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: "bc-1",
                        ...payload,
                        created_at: "2026-09-17T00:00:00Z"
                      },
                      error: null
                    })
                  })
                };
              },
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "bc-1",
                        organization_id: "org-1",
                        provider: "STRIPE",
                        provider_customer_id: "cus_123",
                        email: "billing@example.com",
                        created_at: "2026-09-17T00:00:00Z"
                      },
                      error: null
                    })
                  })
                })
              })
            };
          }

          if (table === "billing_webhook_events") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: null, // first time: not processed
                    error: null
                  })
                })
              }),
              insert: (payload: any) => {
                insertedWebhook = payload;
                return Promise.resolve({ error: null });
              }
            };
          }

          return {};
        }
      }
    };

    const recorded = await recordBillingCustomer(mockDb, {
      organizationId: "org-1",
      provider: "STRIPE",
      providerCustomerId: "cus_123",
      email: "billing@example.com"
    });

    expect(recorded.providerCustomerId).toBe("cus_123");
    expect(upsertPayload.organization_id).toBe("org-1");

    const fetched = await getBillingCustomer(mockDb, "org-1", "STRIPE");
    expect(fetched?.providerCustomerId).toBe("cus_123");

    const webhookResult = await recordBillingWebhookEvent(mockDb, {
      id: "evt_123",
      provider: "STRIPE",
      eventType: "invoice.paid",
      payload: { amount_paid: 49900 }
    });

    expect(webhookResult.processed).toBe(true);
    expect(webhookResult.duplicate).toBe(false);
    expect(insertedWebhook.id).toBe("evt_123");
  });
});
