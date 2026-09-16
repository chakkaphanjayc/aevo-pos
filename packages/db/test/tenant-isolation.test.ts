import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import type { SessionPrincipal } from "@aevo/contracts";
import { canAccessStore, createDatabase, listAuthorizedStores, migrate, type MembershipDocument, type OrganizationDocument, type StoreDocument } from "../src";

const mongodbUri = process.env.TEST_MONGODB_URI;
const databaseName = process.env.TEST_MONGODB_DATABASE ?? "aevo_test";
const integrationTest = mongodbUri ? test : test.skip;

integrationTest("store access never crosses organization boundaries", async () => {
  await migrate(mongodbUri!, databaseName);
  const database = await createDatabase(mongodbUri!, databaseName);
  const suffix = randomUUID().slice(0, 8);
  const organizationAId = randomUUID();
  const organizationBId = randomUUID();
  const storeAId = randomUUID();
  const storeBId = randomUUID();
  const userAId = randomUUID();
  const membershipAId = randomUUID();
  const now = new Date();

  try {
    await database.db.collection<OrganizationDocument>("organizations").insertMany([
      { _id: organizationAId, name: "Tenant A", slug: `tenant-a-${suffix}`, status: "ACTIVE", createdAt: now, updatedAt: now },
      { _id: organizationBId, name: "Tenant B", slug: `tenant-b-${suffix}`, status: "ACTIVE", createdAt: now, updatedAt: now }
    ]);
    await database.db.collection<StoreDocument>("stores").insertMany([
      { _id: storeAId, organizationId: organizationAId, name: "A Store", code: `A-${suffix}`, timezone: "Asia/Bangkok", currency: "THB", status: "ACTIVE", createdAt: now, updatedAt: now },
      { _id: storeBId, organizationId: organizationBId, name: "B Store", code: `B-${suffix}`, timezone: "Asia/Bangkok", currency: "THB", status: "ACTIVE", createdAt: now, updatedAt: now }
    ]);

    const ownerA: SessionPrincipal = {
      userId: userAId, email: "owner-a@example.com", membershipId: membershipAId,
      organizationId: organizationAId, role: "OWNER", permissions: ["store.read"]
    };
    expect(await canAccessStore(database, ownerA, storeAId)).toBeTrue();
    expect(await canAccessStore(database, ownerA, storeBId)).toBeFalse();

    await database.db.collection<MembershipDocument>("memberships").insertOne({
      _id: membershipAId,
      organizationId: organizationAId,
      userId: userAId,
      roleId: randomUUID(),
      status: "ACTIVE",
      storeIds: [storeAId],
      createdAt: now,
      updatedAt: now
    });
    const cashierA: SessionPrincipal = {
      ...ownerA,
      role: "CASHIER",
      permissions: ["store.read"]
    };
    expect(await canAccessStore(database, cashierA, storeAId)).toBeTrue();
    expect(await canAccessStore(database, cashierA, storeBId)).toBeFalse();
    expect(await listAuthorizedStores(database, cashierA)).toEqual([
      { id: storeAId, organizationId: organizationAId, name: "A Store", code: `A-${suffix}`, timezone: "Asia/Bangkok" }
    ]);
  } finally {
    await database.db.collection<MembershipDocument>("memberships").deleteMany({ _id: membershipAId });
    await database.db.collection<StoreDocument>("stores").deleteMany({ _id: { $in: [storeAId, storeBId] } });
    await database.db.collection<OrganizationDocument>("organizations").deleteMany({ _id: { $in: [organizationAId, organizationBId] } });
    await database.close();
  }
});
