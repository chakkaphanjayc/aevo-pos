import type {
  BillingCustomer,
  BillingProvider,
  BillingSubscription,
  BillingWebhookEvent,
  ChangePlanInput,
  CreateCustomerInput,
  CreateSubscriptionInput
} from "@aevo/contracts";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

function mapBillingCustomer(row: Row): BillingCustomer {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    provider: String(row.provider) as BillingCustomer["provider"],
    providerCustomerId: String(row.provider_customer_id),
    email: String(row.email),
    createdAt: String(row.created_at)
  };
}

export async function getBillingCustomer(
  database: Database,
  organizationId: string,
  provider = "STRIPE"
): Promise<BillingCustomer | null> {
  const result = await database.client
    .from("billing_customers")
    .select("id,organization_id,provider,provider_customer_id,email,created_at")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();

  if (result.error) throwDatabaseError(result.error, "get billing customer");
  if (!result.data) return null;
  return mapBillingCustomer(result.data as Row);
}

export async function recordBillingCustomer(
  database: Database,
  customer: {
    organizationId: string;
    provider: "STRIPE" | "OPN" | "XENDIT" | "MANUAL";
    providerCustomerId: string;
    email: string;
  }
): Promise<BillingCustomer> {
  const result = await database.client
    .from("billing_customers")
    .upsert({
      organization_id: customer.organizationId,
      provider: customer.provider,
      provider_customer_id: customer.providerCustomerId,
      email: customer.email
    }, { onConflict: "organization_id,provider" })
    .select("id,organization_id,provider,provider_customer_id,email,created_at")
    .single();

  if (result.error) throwDatabaseError(result.error, "record billing customer");
  return mapBillingCustomer(result.data as Row);
}

export async function recordBillingWebhookEvent(
  database: Database,
  event: {
    id: string;
    provider: "STRIPE" | "OPN" | "XENDIT" | "MANUAL";
    eventType: string;
    payload: Record<string, unknown>;
  }
): Promise<{ processed: boolean; duplicate: boolean }> {
  // Check if already processed
  const existing = await database.client
    .from("billing_webhook_events")
    .select("id,processed")
    .eq("id", event.id)
    .maybeSingle();

  if (existing.data) {
    return { processed: Boolean(existing.data.processed), duplicate: true };
  }

  const insertRes = await database.client
    .from("billing_webhook_events")
    .insert({
      id: event.id,
      provider: event.provider,
      event_type: event.eventType,
      payload: event.payload,
      processed: true
    });

  if (insertRes.error) throwDatabaseError(insertRes.error, "record billing webhook");
  return { processed: true, duplicate: false };
}

/**
 * In-memory Mock Billing Provider for CI, local development, and tests
 */
export class MockBillingAdapter implements BillingProvider {
  private customers = new Map<string, BillingCustomer>();
  private subscriptions = new Map<string, BillingSubscription>();

  async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
    const customer: BillingCustomer = {
      id: `cus-db-${Date.now()}`,
      organizationId: input.organizationId,
      provider: "STRIPE",
      providerCustomerId: `cus_stripe_${Date.now()}`,
      email: input.email,
      createdAt: new Date().toISOString()
    };
    this.customers.set(customer.providerCustomerId, customer);
    return customer;
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription> {
    const sub: BillingSubscription = {
      id: `sub-db-${Date.now()}`,
      providerSubscriptionId: `sub_stripe_${Date.now()}`,
      customerId: input.customerId,
      status: "ACTIVE",
      planCode: input.planCode,
      currentPeriodStartsAt: new Date().toISOString(),
      currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
    this.subscriptions.set(sub.providerSubscriptionId, sub);
    return sub;
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.status = "CANCELED";
    }
  }

  async changePlan(input: ChangePlanInput): Promise<BillingSubscription> {
    const sub = this.subscriptions.get(input.subscriptionId);
    if (!sub) {
      throw new Error(`Subscription ${input.subscriptionId} not found`);
    }
    sub.planCode = input.newPlanCode;
    return sub;
  }

  async getPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    return `https://billing.stripe.com/p/session/test_${customerId}?return_url=${encodeURIComponent(returnUrl)}`;
  }

  async verifyWebhook(request: Request): Promise<BillingWebhookEvent> {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      id: String(payload.id ?? `evt_${Date.now()}`),
      type: String(payload.type ?? "invoice.paid"),
      provider: "STRIPE",
      data: payload,
      createdAt: new Date().toISOString()
    };
  }
}
