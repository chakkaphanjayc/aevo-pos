import { spawn } from "bun";

console.log("\x1b[36m%s\x1b[0m", "🚀 Starting Aevo POS API + Modern Console...");

const api = spawn(["bun", "--env-file=.env", "run", "--cwd", "apps/api", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
  env: process.env
});

const modern = spawn(["bun", "--env-file=.env", "run", "--cwd", "apps/pos-modern", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
  env: process.env
});

function cleanup(): void {
  console.log("\n\x1b[33m%s\x1b[0m", "🛑 Stopping Aevo POS services...");
  api.kill();
  modern.kill();
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

await Promise.race([api.exited, modern.exited]);
cleanup();
