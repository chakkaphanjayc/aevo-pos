import { SQL } from "bun";

export type Database = SQL;

export function createDatabase(databaseUrl: string): Database {
  return new SQL(databaseUrl, { max: 10, idleTimeout: 30, connectionTimeout: 10 });
}
