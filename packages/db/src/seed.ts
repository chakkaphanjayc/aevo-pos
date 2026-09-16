import { createDatabase } from "./client";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "organization";
}

export async function seed(databaseUrl: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  const email = env.SEED_OWNER_EMAIL;
  const password = env.SEED_OWNER_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("SEED_OWNER_EMAIL and a 12+ character SEED_OWNER_PASSWORD are required");
  const organizationName = env.SEED_ORGANIZATION_NAME ?? "Aevo Demo";
  const storeName = env.SEED_STORE_NAME ?? "Main Store";
  const timezone = env.SEED_STORE_TIMEZONE ?? "Asia/Bangkok";
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const sql = createDatabase(databaseUrl);
  try {
    await sql.begin(async (tx) => {
      const orgRows = await tx`INSERT INTO organizations (name, slug) VALUES (${organizationName}, ${slugify(organizationName)})
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      const organizationId = orgRows[0]!.id;
      const userRows = await tx`INSERT INTO users (email, display_name, password_hash)
        VALUES (${email.toLowerCase()}, ${email.split("@")[0] ?? "Owner"}, ${passwordHash})
        ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`;
      const userId = userRows[0]!.id;
      await tx`INSERT INTO stores (organization_id, name, code, timezone)
        VALUES (${organizationId}, ${storeName}, 'MAIN', ${timezone}) ON CONFLICT (organization_id, code) DO NOTHING`;
      await tx`INSERT INTO memberships (organization_id, user_id, role_id)
        SELECT ${organizationId}, ${userId}, id FROM roles WHERE code = 'OWNER'
        ON CONFLICT (organization_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'ACTIVE'`;
    });
    console.info(JSON.stringify({ level: "info", event: "seed.completed", ownerEmail: email }));
  } finally { await sql.close(); }
}

if (import.meta.main) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await seed(process.env.DATABASE_URL);
}
