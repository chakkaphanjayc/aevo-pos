import type {
  BillingCustomer,
  BillingProvider,
  BillingSubscription,
  BillingWebhookEvent,
  ChangePlanInput,
  CreateCustomerInput,
  CreateSubscriptionInput
} from "@aevo/contracts";

export interface StripeBillingConfig {
  secretKey: string;
  webhookSecret?: string | undefined;
  baseUrl?: string | undefined;
}

export class StripeBillingAdapter implements BillingProvider {
  private secretKey: string;
  private webhookSecret?: string | undefined;
  private baseUrl: string;

  constructor(config: StripeBillingConfig) {
    this.secretKey = config.secretKey;
    this.webhookSecret = config.webhookSecret;
    this.baseUrl = config.baseUrl ?? "https://api.stripe.com/v1";
  }

  private async request<T = Record<string, unknown>>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.secretKey}`);

    const res = await fetch(url, {
      ...options,
      headers
    });

    if (!res.ok) {
      const errorData = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = errorData?.error?.message || `Stripe API error: ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    return res.json() as Promise<T>;
  }

  async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
    const body = new URLSearchParams();
    body.set("email", input.email);
    body.set("name", input.name);
    body.set("metadata[organization_id]", input.organizationId);
    if (input.phone) {
      body.set("phone", input.phone);
    }

    const data = await this.request<{
      id: string;
      email?: string;
      created?: number;
    }>("/customers", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    return {
      id: `cus-db-${Date.now()}`,
      organizationId: input.organizationId,
      provider: "STRIPE",
      providerCustomerId: data.id,
      email: data.email || input.email,
      createdAt: data.created ? new Date(data.created * 1000).toISOString() : new Date().toISOString()
    };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription> {
    const body = new URLSearchParams();
    body.set("customer", input.customerId);
    body.set("items[0][price]", input.planCode);
    body.set("metadata[organization_id]", input.organizationId);
    body.set("metadata[app_id]", input.appId);
    if (input.paymentMethodId) {
      body.set("default_payment_method", input.paymentMethodId);
    }

    const data = await this.request<{
      id: string;
      customer: string;
      status: string;
      current_period_start?: number;
      current_period_end?: number;
    }>("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const statusMap: Record<string, BillingSubscription["status"]> = {
      active: "ACTIVE",
      trialing: "TRIALING",
      past_due: "PAST_DUE",
      canceled: "CANCELED"
    };

    return {
      id: `sub-db-${Date.now()}`,
      providerSubscriptionId: data.id,
      customerId: String(data.customer),
      status: statusMap[data.status] || "ACTIVE",
      planCode: input.planCode,
      currentPeriodStartsAt: data.current_period_start ? new Date(data.current_period_start * 1000).toISOString() : new Date().toISOString(),
      currentPeriodEndsAt: data.current_period_end ? new Date(data.current_period_end * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${subscriptionId}`, {
      method: "DELETE"
    });
  }

  async changePlan(input: ChangePlanInput): Promise<BillingSubscription> {
    const sub = await this.request<{
      id: string;
      customer: string;
      status: string;
      items?: { data?: Array<{ id: string }> };
      current_period_start?: number;
      current_period_end?: number;
    }>(`/subscriptions/${input.subscriptionId}`);

    const itemId = sub.items?.data?.[0]?.id;
    const body = new URLSearchParams();
    if (itemId) {
      body.set("items[0][id]", itemId);
      body.set("items[0][price]", input.newPlanCode);
    } else {
      body.set("items[0][price]", input.newPlanCode);
    }

    const updated = await this.request<{
      id: string;
      customer: string;
      status: string;
      current_period_start?: number;
      current_period_end?: number;
    }>(`/subscriptions/${input.subscriptionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    return {
      id: `sub-db-${Date.now()}`,
      providerSubscriptionId: updated.id,
      customerId: String(updated.customer),
      status: "ACTIVE",
      planCode: input.newPlanCode,
      currentPeriodStartsAt: updated.current_period_start ? new Date(updated.current_period_start * 1000).toISOString() : new Date().toISOString(),
      currentPeriodEndsAt: updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  async getPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    const body = new URLSearchParams();
    body.set("customer", customerId);
    body.set("return_url", returnUrl);

    const session = await this.request<{ url: string }>("/billing_portal/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    return session.url;
  }

  async verifyWebhook(request: Request): Promise<BillingWebhookEvent> {
    const rawBody = await request.text();
    const sigHeader = request.headers.get("stripe-signature") || "";

    if (this.webhookSecret) {
      const isValid = await this.verifySignature(rawBody, sigHeader, this.webhookSecret);
      if (!isValid) {
        throw new Error("Invalid Stripe webhook signature");
      }
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    return {
      id: String(payload.id ?? `evt_${Date.now()}`),
      type: String(payload.type ?? "invoice.paid"),
      provider: "STRIPE",
      data: payload,
      createdAt: new Date().toISOString()
    };
  }

  private async verifySignature(rawBody: string, sigHeader: string, secret: string): Promise<boolean> {
    const items = sigHeader.split(",").reduce<Record<string, string>>((acc, item) => {
      const [k, v] = item.split("=");
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});

    const timestamp = items["t"];
    const signature = items["v1"];
    if (!timestamp || !signature) return false;

    // Check timestamp freshness within 5 minutes
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - parseInt(timestamp, 10)) > 300) {
      return false;
    }

    const payload = `${timestamp}.${rawBody}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const hashBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return hashHex === signature;
  }
}
