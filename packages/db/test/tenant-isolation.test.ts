import { expect, test } from "bun:test";
import type { SessionPrincipal } from "@aevo/contracts";
import { canAccessStore, createDatabase, migrate } from "../src";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("store access never crosses organization boundaries", async () => {
  await migrate(databaseUrl!);
  const sql = createDatabase(databaseUrl!);
  const suffix = crypto.randomUUID().slice(0, 8);
  try {
    const [orgA] = await sql`INSERT INTO organizations (name, slug) VALUES ('Tenant A', ${`tenant-a-${suffix}`}) RETURNING id`;
    const [orgB] = await sql`INSERT INTO organizations (name, slug) VALUES ('Tenant B', ${`tenant-b-${suffix}`}) RETURNING id`;
    const [storeA] = await sql`INSERT INTO stores (organization_id, name, code) VALUES (${orgA!.id}, 'A Store', 'MAIN') RETURNING id`;
    const [storeB] = await sql`INSERT INTO stores (organization_id, name, code) VALUES (${orgB!.id}, 'B Store', 'MAIN') RETURNING id`;

    const ownerA: SessionPrincipal = {
      userId: crypto.randomUUID(), email: "owner-a@example.com", membershipId: crypto.randomUUID(),
      organizationId: orgA!.id, role: "OWNER", permissions: ["store.read"]
    };
    expect(await canAccessStore(sql, ownerA, storeA!.id)).toBeTrue();
    expect(await canAccessStore(sql, ownerA, storeB!.id)).toBeFalse();
  } finally { await sql.close(); }
});
