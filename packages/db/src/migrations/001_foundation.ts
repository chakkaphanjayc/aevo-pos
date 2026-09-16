import type { Db } from "mongodb";

export interface MongoMigration {
  version: string;
  checksumSource: string;
  up(database: Db): Promise<void>;
}

const collectionNames = [
  "organizations",
  "brands",
  "stores",
  "users",
  "roles",
  "permissions",
  "memberships",
  "sessions",
  "domain_events",
  "outbox_events",
  "idempotency_keys",
  "audit_logs"
] as const;

async function ensureCollection(database: Db, name: string): Promise<void> {
  try {
    await database.createCollection(name);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== 48) throw error;
  }
}

export const foundationMigration: MongoMigration = {
  version: "001_foundation",
  checksumSource: "aevo-foundation-mongodb-v1",
  async up(database) {
    await Promise.all(collectionNames.map((name) => ensureCollection(database, name)));
    await ensureCollection(database, "schema_migrations");

    await database.collection("organizations").createIndex({ slug: 1 }, {
      name: "organizations_slug_unique",
      unique: true
    });
    await database.collection("organizations").createIndex({ status: 1, name: 1 }, {
      name: "organizations_status_name"
    });

    await database.collection("brands").createIndex({ organizationId: 1, code: 1 }, {
      name: "brands_organization_code_unique",
      unique: true
    });
    await database.collection("brands").createIndex({ organizationId: 1 }, {
      name: "brands_organization"
    });

    await database.collection("stores").createIndex({ organizationId: 1, code: 1 }, {
      name: "stores_organization_code_unique",
      unique: true
    });
    await database.collection("stores").createIndex({ organizationId: 1, status: 1, name: 1 }, {
      name: "stores_organization_status_name"
    });

    await database.collection("users").createIndex({ email: 1 }, {
      name: "users_email_unique",
      unique: true
    });
    await database.collection("users").createIndex({ status: 1, email: 1 }, {
      name: "users_status_email"
    });

    await database.collection("roles").createIndex({ code: 1 }, {
      name: "roles_code_unique",
      unique: true
    });
    await database.collection("permissions").createIndex({ code: 1 }, {
      name: "permissions_code_unique",
      unique: true
    });

    await database.collection("memberships").createIndex({ organizationId: 1, userId: 1 }, {
      name: "memberships_organization_user_unique",
      unique: true
    });
    await database.collection("memberships").createIndex({ userId: 1, organizationId: 1, status: 1 }, {
      name: "memberships_user_organization_status"
    });
    await database.collection("memberships").createIndex({ organizationId: 1, storeIds: 1 }, {
      name: "memberships_organization_store"
    });

    await database.collection("sessions").createIndex({ tokenHash: 1 }, {
      name: "sessions_token_hash_unique",
      unique: true
    });
    await database.collection("sessions").createIndex({ tokenHash: 1, expiresAt: 1, revokedAt: 1 }, {
      name: "sessions_active_token_expiry"
    });
    await database.collection("sessions").createIndex({ expiresAt: 1 }, {
      name: "sessions_expires_ttl",
      expireAfterSeconds: 0
    });

    await database.collection("domain_events").createIndex({ organizationId: 1, aggregateType: 1, aggregateId: 1, occurredAt: 1 }, {
      name: "domain_events_aggregate"
    });
    await database.collection("domain_events").createIndex({ organizationId: 1, occurredAt: 1 }, {
      name: "domain_events_organization_time"
    });

    await database.collection("outbox_events").createIndex({ status: 1, availableAt: 1 }, {
      name: "outbox_events_status_available"
    });
    await database.collection("outbox_events").createIndex({ eventId: 1 }, {
      name: "outbox_events_event_unique",
      unique: true
    });

    await database.collection("idempotency_keys").createIndex({ organizationId: 1, scope: 1, key: 1 }, {
      name: "idempotency_keys_tenant_scope_key_unique",
      unique: true
    });
    await database.collection("idempotency_keys").createIndex({ expiresAt: 1 }, {
      name: "idempotency_keys_expires_ttl",
      expireAfterSeconds: 0
    });

    await database.collection("audit_logs").createIndex({ organizationId: 1, occurredAt: -1 }, {
      name: "audit_logs_tenant_time"
    });
    await database.collection("audit_logs").createIndex({ organizationId: 1, storeId: 1, occurredAt: -1 }, {
      name: "audit_logs_store_time"
    });
  }
};
