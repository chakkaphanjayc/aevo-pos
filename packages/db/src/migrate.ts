import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase } from "./client";

export async function migrate(databaseUrl: string, directory = join(import.meta.dir, "../migrations")): Promise<void> {
  const sql = createDatabase(databaseUrl);
  try {
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const body = await Bun.file(join(directory, file)).text();
      const checksum = createHash("sha256").update(body).digest("hex");
      const existing = await sql`SELECT checksum FROM schema_migrations WHERE version = ${file}`;
      if (existing.length) {
        if (existing[0]?.checksum !== checksum) throw new Error(`Migration ${file} changed after it was applied`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (version, checksum) VALUES (${file}, ${checksum})
                 ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum`;
      });
      console.info(JSON.stringify({ level: "info", event: "migration.applied", migration: file }));
    }
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  await migrate(databaseUrl);
}
