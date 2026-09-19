import fs from "node:fs";
import path from "node:path";

// Extract project ref from SUPABASE_URL (e.g. https://rltoatfluvebgnxjajit.supabase.co -> rltoatfluvebgnxjajit)
const supabaseUrl = process.env.SUPABASE_URL || "https://rltoatfluvebgnxjajit.supabase.co";
const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "").trim();
const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.SEED_OWNER_PASSWORD || "Jnaimcee.007";
const dbHost = process.env.SUPABASE_DB_HOST || `db.${projectRef}.supabase.co`;
const dbPort = process.env.SUPABASE_DB_PORT || "5432";
const dbName = process.env.SUPABASE_DB_NAME || "postgres";

const connectionString = `postgres://postgres:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}?sslmode=require`;

console.log(`Connecting to Supabase PostgreSQL at ${dbHost}:${dbPort}/${dbName}...`);
const sql = new Bun.SQL(connectionString);

async function runMigrations() {
  try {
    // 1. Ensure supabase_migrations schema and table exist
    await sql`CREATE SCHEMA IF NOT EXISTS supabase_migrations;`;
    await sql`
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version text PRIMARY KEY,
        statements text[],
        name text
      );
    `;

    // 2. Fetch applied migrations
    const appliedRows = await sql`
      SELECT version FROM supabase_migrations.schema_migrations;
    `;
    const appliedSet = new Set(appliedRows.map((r: any) => String(r.version)));
    console.log(`Found ${appliedSet.size} previously applied migrations in remote database.`);

    // 3. Read migration files
    const migrationsDir = path.resolve(import.meta.dir, "../supabase/migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const version = file.split("_")[0];
      if (appliedSet.has(version)) {
        skippedCount++;
        continue;
      }

      console.log(`\n▶ Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      let content = fs.readFileSync(filePath, "utf-8");

      // Make CREATE POLICY idempotent by injecting DROP POLICY IF EXISTS before CREATE POLICY
      content = content.replace(
        /CREATE\s+POLICY\s+(["]?[a-zA-Z0-9_]+["]?)\s+ON\s+([a-zA-Z0-9_.]+)/gi,
        (match, policyName, tableName) => `DROP POLICY IF EXISTS ${policyName} ON ${tableName}; ${match}`
      );

      try {
        // Execute migration
        await sql.unsafe(content);

        // Record in schema_migrations
        await sql`
          INSERT INTO supabase_migrations.schema_migrations (version, name)
          VALUES (${version}, ${file})
          ON CONFLICT (version) DO NOTHING;
        `;

        console.log(`✓ Migration ${file} applied successfully.`);
        appliedCount++;
      } catch (err: any) {
        console.error(`✗ Failed to apply migration ${file}:`, err.message);
        throw err;
      }
    }

    console.log(`\n========================================`);
    console.log(`Migrations complete! Applied: ${appliedCount}, Skipped: ${skippedCount}, Total: ${files.length}`);
    console.log(`========================================`);

    // Print summary of newly available tables in public
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log(`\nActive public tables count: ${tables.length}`);
    console.log(tables.map((t: any) => t.table_name).join(", "));

  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  } finally {
    await sql.close();
  }
}

await runMigrations();
