import { createHash } from "node:crypto";
import { createDatabase } from "./client";
import { foundationMigration, type MongoMigration } from "./migrations/001_foundation";

export const migrations: MongoMigration[] = [foundationMigration];

export async function migrate(mongodbUri: string, databaseName = "aevo"): Promise<void> {
  const database = await createDatabase(mongodbUri, databaseName);
  try {
    const appliedMigrations = database.db.collection<{ _id: string; version: string; checksum: string; appliedAt: Date }>("schema_migrations");
    for (const migration of migrations) {
      const checksum = createHash("sha256").update(migration.checksumSource).digest("hex");
      const existing = await appliedMigrations.findOne({ _id: migration.version });
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Migration ${migration.version} changed after it was applied`);
        continue;
      }

      await migration.up(database.db);
      await appliedMigrations.insertOne({
        _id: migration.version,
        version: migration.version,
        checksum,
        appliedAt: new Date()
      });
      console.info(JSON.stringify({ level: "info", event: "migration.applied", migration: migration.version }));
    }
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  const mongodbUri = process.env.MONGODB_URI;
  if (!mongodbUri) throw new Error("MONGODB_URI is required");
  await migrate(mongodbUri, process.env.MONGODB_DATABASE ?? "aevo");
}
