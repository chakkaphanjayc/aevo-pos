import type { DeviceMode, DeviceSummary, SessionPrincipal } from "@aevo/contracts";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapDevice(row: Row): DeviceSummary {
  const mode = String(row.mode);
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    name: String(row.name),
    mode: (mode === "KIOSK" || mode === "KDS" || mode === "QUEUE_DISPLAY" ? mode : "POS") as DeviceMode,
    ...(row.station_id === null || row.station_id === undefined ? {} : { stationId: String(row.station_id) }),
    status: row.status === "REVOKED" ? "REVOKED" : "ACTIVE",
    ...(optionalString(row.paired_at) ? { pairedAt: String(row.paired_at) } : {}),
    ...(optionalString(row.last_seen_at) ? { lastSeenAt: String(row.last_seen_at) } : {}),
    ...(optionalString(row.pairing_expires_at) ? { pairingExpiresAt: String(row.pairing_expires_at) } : {}),
    createdAt: String(row.created_at)
  };
}

const select = "id,organization_id,store_id,name,mode,station_id,status,paired_at,last_seen_at,pairing_expires_at,created_at";

export async function listDevices(database: Database, principal: SessionPrincipal, storeId: string): Promise<DeviceSummary[]> {
  const result = await database.client
    .from("devices")
    .select(select)
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  throwDatabaseError(result.error, "device list");
  if (!result.data) return [];
  return (result.data as Row[]).map(mapDevice);
}

export async function createDevice(
  database: Database,
  principal: SessionPrincipal,
  input: { storeId: string; name: string; mode: DeviceMode; stationId?: string; pairingCodeHash: string; pairingExpiresAt: string }
): Promise<DeviceSummary> {
  const result = await database.client
    .from("devices")
    .insert({
      organization_id: principal.organizationId,
      store_id: input.storeId,
      name: input.name.trim(),
      mode: input.mode,
      station_id: input.stationId ?? null,
      pairing_code_hash: input.pairingCodeHash,
      pairing_expires_at: input.pairingExpiresAt,
      status: "ACTIVE"
    })
    .select(select)
    .single();
  throwDatabaseError(result.error, "device create");
  if (!result.data) throw new Error("Failed to create device: no device was returned");
  return mapDevice(result.data as Row);
}

export async function findPairingDevice(database: Database, pairingCodeHash: string): Promise<DeviceSummary | null> {
  const result = await database.client
    .from("devices")
    .select(select)
    .eq("pairing_code_hash", pairingCodeHash)
    .eq("status", "ACTIVE")
    .gt("pairing_expires_at", new Date().toISOString())
    .maybeSingle();
  throwDatabaseError(result.error, "device pairing lookup");
  if (!result.data) return null;
  return mapDevice(result.data as Row);
}

export async function pairDevice(database: Database, deviceId: string, deviceTokenHash: string): Promise<DeviceSummary | null> {
  const result = await database.client
    .from("devices")
    .update({
      device_token_hash: deviceTokenHash,
      pairing_code_hash: null,
      pairing_expires_at: null,
      paired_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    })
    .eq("id", deviceId)
    .eq("status", "ACTIVE")
    .select(select)
    .single();
  throwDatabaseError(result.error, "device pairing");
  if (!result.data) return null;
  return mapDevice(result.data as Row);
}

export async function findDeviceByTokenHash(database: Database, deviceTokenHash: string): Promise<DeviceSummary | null> {
  const result = await database.client
    .from("devices")
    .select(select)
    .eq("device_token_hash", deviceTokenHash)
    .eq("status", "ACTIVE")
    .maybeSingle();
  throwDatabaseError(result.error, "device token lookup");
  if (!result.data) return null;
  return mapDevice(result.data as Row);
}

export async function touchDevice(database: Database, deviceId: string): Promise<void> {
  const result = await database.client.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
  throwDatabaseError(result.error, "device heartbeat");
}

export async function revokeDevice(database: Database, principal: SessionPrincipal, storeId: string, deviceId: string): Promise<boolean> {
  const result = await database.client
    .from("devices")
    .update({ status: "REVOKED", device_token_hash: null, pairing_code_hash: null })
    .eq("id", deviceId)
    .eq("organization_id", principal.organizationId)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();
  throwDatabaseError(result.error, "device revoke");
  return Boolean(result.data);
}
