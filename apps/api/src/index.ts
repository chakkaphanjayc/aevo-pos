import { loadConfig } from "@aevo/config";
import { createDatabase } from "@aevo/db";
import { createApp } from "./app";

const config = loadConfig();
const database = await createDatabase(config.mongodbUri, config.mongodbDatabase);
const app = createApp({ config, database });

app.listen({ hostname: config.apiHost, port: config.apiPort });
console.info(JSON.stringify({ level: "info", event: "server.started", host: config.apiHost, port: config.apiPort }));

const shutdown = async () => {
  app.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
