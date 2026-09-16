import { MongoClient, type ClientSession, type Db } from "mongodb";

export interface Database {
  readonly client: MongoClient;
  readonly db: Db;
  ping(): Promise<void>;
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Create a connected MongoDB client for the configured database.
 *
 * The connection is established before the API starts accepting requests so a
 * bad Atlas URI or unavailable cluster fails fast during startup.
 */
export async function createDatabase(mongodbUri: string, databaseName = "aevo"): Promise<Database> {
  const client = new MongoClient(mongodbUri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000
  });
  await client.connect();
  const db = client.db(databaseName);
  return {
    client,
    db,
    ping: async () => {
      await db.command({ ping: 1 });
    },
    withTransaction: async <T>(work: (session: ClientSession) => Promise<T>) =>
      client.withSession((session) => session.withTransaction(() => work(session))),
    close: () => client.close()
  };
}
