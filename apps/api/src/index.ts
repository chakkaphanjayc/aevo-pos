import { loadConfig } from "@aevo/config";
import { createDatabase } from "@aevo/db";
import { createApp } from "./app";

const config = loadConfig();
const sql = createDatabase(config.databaseUrl);
const app = createApp({ config, sql });

app.listen({ hostname: config.apiHost, port: config.apiPort });
console.info(JSON.stringify({ level: "info", event: "server.started", host: config.apiHost, port: config.apiPort }));

const shutdown = async () => {
  app.stop();
  await sql.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
