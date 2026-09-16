import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import type { Permission, Role, SessionPrincipal, StoreSummary } from "@aevo/contracts";
import { permissions as permissionCodes, roles as roleCodes } from "@aevo/contracts";
import type { Database } from "./client";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface UserDocument {
  _id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationDocument {
  _id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreDocument {
  _id: string;
  organizationId: string;
  name: string;
  code: string;
  timezone: string;
  currency: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleDocument {
  _id: string;
  code: Role;
  name: string;
  isSystem: boolean;
  permissionCodes: Permission[];
}

export interface MembershipDocument {
  _id: string;
  organizationId: string;
  userId: string;
  roleId: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  /** Empty means the member has no store access unless their role is elevated. */
  storeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface SessionDocument {
  _id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

function storesCollection(database: Database) {
  return database.db.collection<StoreDocument>("stores");
}

function membershipsCollection(database: Database) {
  return database.db.collection<MembershipDocument>("memberships");
}

export async function findActiveUserByEmail(database: Database, email: string): Promise<UserRecord | null> {
  const user = await database.db.collection<UserDocument>("users").findOne({
    email: email.trim().toLowerCase(),
    status: "ACTIVE"
  });
  return user
    ? { id: user._id, email: user.email, displayName: user.displayName, passwordHash: user.passwordHash }
    : null;
}

export async function createSession(
  database: Database,
  input: { userId: string; tokenHash: string; expiresAt: Date; ipAddress?: string; userAgent?: string }
): Promise<void> {
  const now = new Date();
  const session: SessionDocument = {
    _id: randomUUID(),
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
    ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {})
  };
  await database.db.collection<SessionDocument>("sessions").insertOne(session);
}

export async function revokeSession(database: Database, tokenHash: string): Promise<void> {
  await database.db.collection<SessionDocument>("sessions").updateOne(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function resolvePrincipal(
  database: Database,
  tokenHash: string,
  requestedOrganizationId?: string
): Promise<SessionPrincipal | null> {
  const session = await database.db.collection<SessionDocument>("sessions").findOne({
    tokenHash,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;

  // Keep a lightweight activity timestamp for session/device administration.
  // The update is intentionally best-effort with respect to the lookup: the
  // session has already been proven active by the query above.
  void database.db.collection<SessionDocument>("sessions").updateOne(
    { _id: session._id, revokedAt: null },
    { $set: { lastSeenAt: new Date() } }
  ).catch(() => undefined);

  const user = await database.db.collection<UserDocument>("users").findOne({ _id: session.userId, status: "ACTIVE" });
  if (!user) return null;

  const membershipFilter: Filter<MembershipDocument> = { userId: user._id, status: "ACTIVE" };
  if (requestedOrganizationId) membershipFilter.organizationId = requestedOrganizationId;
  const membership = await membershipsCollection(database)
    .find(membershipFilter)
    .sort({ createdAt: 1 })
    .limit(1)
    .next();
  if (!membership) return null;

  const role = await database.db.collection<RoleDocument>("roles").findOne({ _id: membership.roleId });
  if (!role || !roleCodes.includes(role.code)) return null;

  return {
    userId: user._id,
    email: user.email,
    displayName: user.displayName,
    membershipId: membership._id,
    organizationId: membership.organizationId,
    role: role.code,
    permissions: role.permissionCodes.filter((code): code is Permission => permissionCodes.includes(code))
  };
}

export async function listAuthorizedStores(database: Database, principal: SessionPrincipal): Promise<StoreSummary[]> {
  const filter: Filter<StoreDocument> = {
    organizationId: principal.organizationId,
    status: "ACTIVE"
  };

  if (principal.role !== "OWNER" && principal.role !== "ADMIN") {
    const membership = await membershipsCollection(database).findOne({
      _id: principal.membershipId,
      organizationId: principal.organizationId,
      userId: principal.userId,
      status: "ACTIVE"
    });
    const storeIds = membership?.storeIds ?? [];
    if (storeIds.length === 0) return [];
    filter._id = { $in: storeIds };
  }

  const stores = await storesCollection(database).find(filter).sort({ name: 1 }).toArray();
  return stores.map((store) => ({
    id: store._id,
    organizationId: store.organizationId,
    name: store.name,
    code: store.code,
    timezone: store.timezone
  }));
}

export async function canAccessStore(database: Database, principal: SessionPrincipal, storeId: string): Promise<boolean> {
  const store = await storesCollection(database).findOne({
    _id: storeId,
    organizationId: principal.organizationId,
    status: "ACTIVE"
  });
  if (!store) return false;
  if (principal.role === "OWNER" || principal.role === "ADMIN") return true;

  const membership = await membershipsCollection(database).findOne({
    _id: principal.membershipId,
    organizationId: principal.organizationId,
    userId: principal.userId,
    status: "ACTIVE"
  });
  return membership?.storeIds.includes(store._id) ?? false;
}
