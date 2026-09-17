export type PushPlatform = "WEB" | "IOS" | "ANDROID";

export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: WebPushKeys;
}

export interface PushSubscriptionRecord {
  id: string;
  organizationId: string;
  storeId?: string;
  userId?: string;
  platform: PushPlatform;
  deviceToken?: string;
  webPushSubscription?: WebPushSubscription;
  createdAt: string;
}

export function validateWebPushSubscription(sub: unknown): sub is WebPushSubscription {
  if (!sub || typeof sub !== "object") return false;
  const s = sub as Record<string, unknown>;
  if (typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://")) return false;
  if (!s.keys || typeof s.keys !== "object") return false;
  const keys = s.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}
