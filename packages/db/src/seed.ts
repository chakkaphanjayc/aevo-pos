import { randomUUID } from "node:crypto";
import type { Permission, Role } from "@aevo/contracts";
import { permissions, roles } from "@aevo/contracts";
import { createDatabase } from "./client";
import type { MembershipDocument, OrganizationDocument, RoleDocument, StoreDocument, UserDocument } from "./repository";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "organization";
}

const rolePermissions: Record<Role, Permission[]> = {
  OWNER: [...permissions],
  ADMIN: [...permissions],
  BRANCH_MANAGER: [
    "store.read", "catalog.read", "catalog.manage", "order.read", "order.create", "payment.receive",
    "refund.create", "order.void", "price.override", "cash_drawer.open", "audit.read"
  ],
  CASHIER: ["store.read", "catalog.read", "order.read", "order.create", "payment.receive"],
  KITCHEN: ["store.read", "order.read"],
  STAFF: ["store.read", "catalog.read", "order.read", "order.create"],
  VIEWER: ["store.read", "order.read"]
};

export async function seed(databaseUri: string, databaseName = "aevo", env: Record<string, string | undefined> = process.env): Promise<void> {
  const email = env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const password = env.SEED_OWNER_PASSWORD;
  if (!email || !password || password.length < 12 || password === "change-me-now") {
    throw new Error("Set SEED_OWNER_EMAIL and a unique 12+ character SEED_OWNER_PASSWORD before seeding");
  }
  const organizationName = env.SEED_ORGANIZATION_NAME ?? "Aevo Demo";
  const storeName = env.SEED_STORE_NAME ?? "Main Store";
  const timezone = env.SEED_STORE_TIMEZONE ?? "Asia/Bangkok";
  const requestedInitialRole = (env.SEED_INITIAL_ROLE ?? "OWNER").trim().toUpperCase();
  if (!roles.includes(requestedInitialRole as Role)) {
    throw new Error("SEED_INITIAL_ROLE must be one of the supported roles");
  }
  const initialRoleCode = requestedInitialRole as Role;
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const database = await createDatabase(databaseUri, databaseName);
  const now = new Date();

  try {
    const roleCollection = database.db.collection<RoleDocument>("roles");
    for (const role of roles) {
      await roleCollection.updateOne(
        { code: role },
        {
          $set: { name: role === "BRANCH_MANAGER" ? "Branch manager" : role[0] + role.slice(1).toLowerCase(), isSystem: true, permissionCodes: rolePermissions[role] },
          $setOnInsert: { _id: randomUUID() }
        },
        { upsert: true }
      );
    }

    const permissionCollection = database.db.collection<{ _id: string; code: Permission; description: string }>("permissions");
    for (const permission of permissions) {
      await permissionCollection.updateOne(
        { code: permission },
        {
          $set: { description: permission.replaceAll(".", " ") },
          $setOnInsert: { _id: randomUUID() }
        },
        { upsert: true }
      );
    }

    const organizationSlug = slugify(organizationName);
    const organizationCollection = database.db.collection<OrganizationDocument>("organizations");
    await organizationCollection.updateOne(
      { slug: organizationSlug },
      {
        $set: { name: organizationName, status: "ACTIVE", updatedAt: now },
        $setOnInsert: { _id: randomUUID(), createdAt: now }
      },
      { upsert: true }
    );
    const organization = await organizationCollection.findOne({ slug: organizationSlug });
    if (!organization) throw new Error("Unable to create seed organization");

    const userCollection = database.db.collection<UserDocument>("users");
    await userCollection.updateOne(
      { email },
      {
        $set: {
          displayName: email.split("@")[0] ?? "Owner",
          passwordHash,
          status: "ACTIVE",
          updatedAt: now
        },
        $setOnInsert: { _id: randomUUID(), createdAt: now }
      },
      { upsert: true }
    );
    const user = await userCollection.findOne({ email });
    if (!user) throw new Error("Unable to create seed owner");

    const storeCollection = database.db.collection<StoreDocument>("stores");
    await storeCollection.updateOne(
      { organizationId: organization._id, code: "MAIN" },
      {
        $set: { name: storeName, timezone, currency: "THB", status: "ACTIVE", updatedAt: now },
        $setOnInsert: { _id: randomUUID(), createdAt: now }
      },
      { upsert: true }
    );

    const initialRole = await roleCollection.findOne({ code: initialRoleCode });
    if (!initialRole) throw new Error(`Unable to create ${initialRoleCode} role`);
    const membershipCollection = database.db.collection<MembershipDocument>("memberships");
    await membershipCollection.updateOne(
      { organizationId: organization._id, userId: user._id },
      {
        $set: { roleId: initialRole._id, status: "ACTIVE", storeIds: [], updatedAt: now },
        $setOnInsert: { _id: randomUUID(), createdAt: now }
      },
      { upsert: true }
    );
    console.info(JSON.stringify({ level: "info", event: "seed.completed", ownerEmail: email, role: initialRoleCode, database: databaseName }));
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  const databaseUri = process.env.MONGODB_URI;
  if (!databaseUri) throw new Error("MONGODB_URI is required");
  await seed(databaseUri, process.env.MONGODB_DATABASE ?? "aevo");
}
