import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import type { AppConfig } from "@aevo/config";
import { createApp } from "../src/app";
import { createDatabase, migrate, type MembershipDocument, type OrganizationDocument, type RoleDocument, type UserDocument } from "@aevo/db";

const mongodbUri = process.env.TEST_MONGODB_URI;
const integrationTest = mongodbUri ? test : test.skip;

integrationTest("MongoDB-backed login creates and resolves a session", async () => {
  const databaseName = process.env.TEST_MONGODB_DATABASE ?? "aevo_test";
  await migrate(mongodbUri!, databaseName);
  const database = await createDatabase(mongodbUri!, databaseName);
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const organizationId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const email = `login-${suffix}@example.com`;
  const password = "correct horse battery staple";
  const now = new Date();
  const config: AppConfig = {
    nodeEnv: "test", apiHost: "127.0.0.1", apiPort: 3001, webOrigin: "http://localhost:4321",
    mongodbUri: mongodbUri!, mongodbDatabase: databaseName,
    sessionCookieName: "aevo_session", sessionTtlHours: 1, logLevel: "error"
  };

  try {
    await database.db.collection<RoleDocument>("roles").insertOne({
      _id: roleId, code: "OWNER", name: "Owner", isSystem: true,
      permissionCodes: ["store.read"],
    });
    await database.db.collection<UserDocument>("users").insertOne({
      _id: userId, email, displayName: "Integration Owner", passwordHash: await Bun.password.hash(password, { algorithm: "argon2id" }),
      status: "ACTIVE", createdAt: now, updatedAt: now
    });
    await database.db.collection<OrganizationDocument>("organizations").insertOne({
      _id: organizationId, name: `Login ${suffix}`, slug: `login-${suffix}`, status: "ACTIVE", createdAt: now, updatedAt: now
    });
    await database.db.collection<MembershipDocument>("memberships").insertOne({
      _id: membershipId, organizationId, userId, roleId, status: "ACTIVE", storeIds: [], createdAt: now, updatedAt: now
    });

    const app = createApp({ config, database });
    const login = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: config.webOrigin },
      body: JSON.stringify({ email: email.toUpperCase(), password })
    }));
    expect(login.status).toBe(204);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toBeTruthy();

    const me = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { cookie: cookie!.split(";", 1)[0]! }
    }));
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: {
        userId, email, displayName: "Integration Owner", organizationId, membershipId,
        role: "OWNER", permissions: ["store.read"]
      }
    });
  } finally {
    await database.db.collection<{ userId: string }>("sessions").deleteMany({ userId });
    await database.db.collection<{ _id: string }>("memberships").deleteMany({ _id: membershipId });
    await database.db.collection<{ _id: string }>("users").deleteMany({ _id: userId });
    await database.db.collection<{ _id: string }>("organizations").deleteMany({ _id: organizationId });
    await database.db.collection<{ _id: string }>("roles").deleteMany({ _id: roleId });
    await database.close();
  }
});
