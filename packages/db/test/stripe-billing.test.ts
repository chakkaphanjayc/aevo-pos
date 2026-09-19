import { describe, expect, it } from "bun:test";
import { StripeBillingAdapter } from "../src/stripe-billing";

describe("StripeBillingAdapter", () => {
  it("creates customer via Stripe REST API", async () => {
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body);

      return new Response(JSON.stringify({
        id: "cus_stripe_mock_123",
        email: "org@example.com",
        created: 1700000000
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    try {
      const adapter = new StripeBillingAdapter({
        secretKey: "sk_test_fake_123"
      });

      const customer = await adapter.createCustomer({
        organizationId: "org-test-1",
        name: "Test Store",
        email: "org@example.com",
        phone: "0812345678"
      });

      expect(capturedUrl).toBe("https://api.stripe.com/v1/customers");
      expect(capturedHeaders?.get("Authorization")).toBe("Bearer sk_test_fake_123");
      expect(capturedBody).toContain("email=org%40example.com");
      expect(capturedBody).toContain("metadata%5Borganization_id%5D=org-test-1");

      expect(customer.provider).toBe("STRIPE");
      expect(customer.providerCustomerId).toBe("cus_stripe_mock_123");
      expect(customer.email).toBe("org@example.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates subscription with plan code", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);

      return new Response(JSON.stringify({
        id: "sub_stripe_mock_456",
        customer: "cus_stripe_mock_123",
        status: "active",
        current_period_start: 1700000000,
        current_period_end: 1702592000
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    try {
      const adapter = new StripeBillingAdapter({
        secretKey: "sk_test_fake_123"
      });

      const sub = await adapter.createSubscription({
        organizationId: "org-test-1",
        customerId: "cus_stripe_mock_123",
        appId: "booking",
        planCode: "price_business_monthly"
      });

      expect(capturedUrl).toBe("https://api.stripe.com/v1/subscriptions");
      expect(capturedBody).toContain("items%5B0%5D%5Bprice%5D=price_business_monthly");
      expect(sub.providerSubscriptionId).toBe("sub_stripe_mock_456");
      expect(sub.status).toBe("ACTIVE");
      expect(sub.planCode).toBe("price_business_monthly");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retrieves customer portal session URL", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);

      return new Response(JSON.stringify({
        url: "https://billing.stripe.com/p/session/live_portal_mock_url"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    try {
      const adapter = new StripeBillingAdapter({
        secretKey: "sk_test_fake_123"
      });

      const portalUrl = await adapter.getPortalUrl("cus_stripe_mock_123", "https://pos.aevo.app/staff/hub");
      expect(capturedUrl).toBe("https://api.stripe.com/v1/billing_portal/sessions");
      expect(capturedBody).toContain("customer=cus_stripe_mock_123");
      expect(portalUrl).toBe("https://billing.stripe.com/p/session/live_portal_mock_url");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("verifies webhook HMAC-SHA256 signature accurately", async () => {
    const webhookSecret = "whsec_test_secret_key_12345";
    const payload = JSON.stringify({ id: "evt_test_123", type: "invoice.paid", object: "event" });
    const timestamp = Math.floor(Date.now() / 1000);

    // Compute expected signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const hashBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
    const signatureHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const adapter = new StripeBillingAdapter({
      secretKey: "sk_test_fake_123",
      webhookSecret
    });

    // 1. Valid request
    const validRequest = new Request("https://api.aevo.app/api/hub/billing/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signatureHex}`
      },
      body: payload
    });

    const event = await adapter.verifyWebhook(validRequest);
    expect(event.id).toBe("evt_test_123");
    expect(event.type).toBe("invoice.paid");
    expect(event.provider).toBe("STRIPE");

    // 2. Tampered signature request
    const invalidRequest = new Request("https://api.aevo.app/api/hub/billing/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=bad_tampered_signature_hex`
      },
      body: payload
    });

    expect(adapter.verifyWebhook(invalidRequest)).rejects.toThrow("Invalid Stripe webhook signature");
  });
});
