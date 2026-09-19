import type {
  AppDefinition,
  AppEntitlement,
  AppPricingModel,
  AppStatus,
  AppSubscriptionSummary,
  FeatureEntitlement,
  SessionPrincipal,
  SubscriptionStatus
} from "@aevo/contracts";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

function mapApp(row: Row): AppDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    icon: String(row.icon),
    pricingModel: String(row.pricing_model) as AppPricingModel,
    basePriceMonthlyMinor: Number(row.base_price_monthly_minor ?? 0),
    status: String(row.status) as AppStatus,
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
    createdAt: String(row.created_at)
  };
}

function calculateDaysRemaining(targetDateStr?: string | null): number | undefined {
  if (!targetDateStr) return undefined;
  const targetTime = new Date(targetDateStr).getTime();
  const now = Date.now();
  const diffMs = targetTime - now;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function mapSubscription(row: Row): AppSubscriptionSummary {
  const status = String(row.status) as SubscriptionStatus;
  const trialEndsAt = row.trial_ends_at ? String(row.trial_ends_at) : null;
  const currentPeriodEndsAt = String(row.current_period_ends_at);
  const gracePeriodEndsAt = row.grace_period_ends_at ? String(row.grace_period_ends_at) : null;

  const now = Date.now();
  let isEntitled = false;

  if (status === "ACTIVE" && new Date(currentPeriodEndsAt).getTime() >= now) {
    isEntitled = true;
  } else if (status === "TRIAL" && trialEndsAt && new Date(trialEndsAt).getTime() >= now) {
    isEntitled = true;
  } else if (gracePeriodEndsAt && new Date(gracePeriodEndsAt).getTime() >= now) {
    isEntitled = true;
  }

  const daysRemaining = status === "TRIAL"
    ? calculateDaysRemaining(trialEndsAt)
    : calculateDaysRemaining(currentPeriodEndsAt);

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: row.store_id ? String(row.store_id) : null,
    appId: String(row.app_id),
    status,
    planCode: String(row.plan_code ?? "STANDARD"),
    trialEndsAt,
    currentPeriodStartsAt: String(row.current_period_starts_at),
    currentPeriodEndsAt,
    gracePeriodEndsAt,
    deviceLimit: row.device_limit !== null && row.device_limit !== undefined ? Number(row.device_limit) : null,
    resourceLimit: row.resource_limit !== null && row.resource_limit !== undefined ? Number(row.resource_limit) : null,
    isEntitled,
    daysRemaining,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export async function listApps(database: Database): Promise<AppDefinition[]> {
  const result = await database.client
    .from("apps")
    .select("id,name,description,icon,pricing_model,base_price_monthly_minor,status,features,created_at")
    .order("created_at", { ascending: true });

  throwDatabaseError(result.error, "list apps");
  if (!result.data) return [];
  return (result.data as Row[]).map(mapApp);
}

export async function listOrganizationSubscriptions(
  database: Database,
  principal: SessionPrincipal,
  storeId?: string
): Promise<AppSubscriptionSummary[]> {
  let query = database.client
    .from("app_subscriptions")
    .select("id,organization_id,store_id,app_id,status,plan_code,trial_ends_at,current_period_starts_at,current_period_ends_at,grace_period_ends_at,device_limit,resource_limit,created_at,updated_at")
    .eq("organization_id", principal.organizationId);

  if (storeId) {
    // Return store-specific or org-wide subscriptions
    query = query.or(`store_id.eq.${storeId},store_id.is.null`);
  }

  const result = await query.order("created_at", { ascending: true });
  throwDatabaseError(result.error, "list subscriptions");
  if (!result.data) return [];
  return (result.data as Row[]).map(mapSubscription);
}

export async function getAppEntitlement(
  database: Database,
  principal: SessionPrincipal,
  appId: string,
  storeId?: string
): Promise<AppEntitlement> {
  const subscriptions = await listOrganizationSubscriptions(database, principal, storeId);
  const matched = subscriptions.find((sub) => sub.appId === appId);

  const appFeatureMap: Record<string, FeatureEntitlement[]> = {
    pos: ["pos.use", "reports.advanced"],
    kiosk: ["kiosk.use"],
    booking: ["booking.use", "booking.waitlist"],
    crm: ["reports.advanced"],
    inventory: ["odoo.sync"]
  };

  if (!matched) {
    return {
      appId,
      isEntitled: false,
      status: "UNSUBSCRIBED",
      features: []
    };
  }

  return {
    appId,
    isEntitled: matched.isEntitled,
    status: matched.status,
    trialEndsAt: matched.trialEndsAt,
    currentPeriodEndsAt: matched.currentPeriodEndsAt,
    daysRemaining: matched.daysRemaining,
    features: matched.isEntitled ? (appFeatureMap[appId] ?? []) : []
  };
}

export async function startAppTrial(
  database: Database,
  principal: SessionPrincipal,
  input: { appId: string; storeId?: string | undefined }
): Promise<AppSubscriptionSummary> {

  const now = new Date();
  const trialDays = 14;
  const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  const graceEnd = new Date(now.getTime() + (trialDays + 14) * 24 * 60 * 60 * 1000).toISOString();

  const insertPayload = {
    organization_id: principal.organizationId,
    store_id: input.storeId ?? null,
    app_id: input.appId,
    status: "TRIAL",
    plan_code: "STANDARD",
    trial_ends_at: trialEnd,
    current_period_starts_at: now.toISOString(),
    current_period_ends_at: trialEnd,
    grace_period_ends_at: graceEnd
  };

  const result = await database.client
    .from("app_subscriptions")
    .upsert(insertPayload, { onConflict: "organization_id,store_id,app_id" })
    .select("id,organization_id,store_id,app_id,status,plan_code,trial_ends_at,current_period_starts_at,current_period_ends_at,grace_period_ends_at,device_limit,resource_limit,created_at,updated_at")
    .single();

  throwDatabaseError(result.error, "start app trial");
  return mapSubscription(result.data as Row);
}
