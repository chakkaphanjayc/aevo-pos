import { createApp } from "@aevo/api";
import { loadConfig } from "@aevo/config";
import { createDatabase, type Database } from "@aevo/db";

export interface WorkerAssets {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  WEB_ORIGIN: string;
  SESSION_COOKIE_NAME?: string;
  SESSION_COOKIE_SAME_SITE?: "lax" | "strict" | "none";
  LOG_LEVEL?: "debug" | "info" | "warn" | "error";
  ASSETS: WorkerAssets;
}

export interface WorkerRuntime {
  app: { handle(request: Request): Promise<Response> };
  database: Database;
}

function createRuntime(env: WorkerEnv): WorkerRuntime {
  const supabaseKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey) throw new Error("SUPABASE_SECRET_KEY is not configured");
  const config = loadConfig({
    NODE_ENV: "production",
    API_HOST: "0.0.0.0",
    API_PORT: "8787",
    WEB_ORIGIN: env.WEB_ORIGIN,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: supabaseKey,
    SESSION_COOKIE_NAME: env.SESSION_COOKIE_NAME,
    SESSION_COOKIE_SAME_SITE: env.SESSION_COOKIE_SAME_SITE,
    LOG_LEVEL: env.LOG_LEVEL
  });
  const database = createDatabase(config.supabaseUrl, config.supabaseKey);
  return { database, app: createApp({ config, database }) };
}

/**
 * Build a Worker handler. The optional runtime factory keeps routing testable
 * without contacting a real Supabase project.
 */
export function createWorker(
  runtimeFactory: (env: WorkerEnv) => WorkerRuntime = createRuntime
) {
  const runtimes = new WeakMap<object, WorkerRuntime>();
  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/") || pathname === "/health" || pathname === "/ready") {
        let runtime = runtimes.get(env as object);
        if (!runtime) {
          runtime = runtimeFactory(env);
          runtimes.set(env as object, runtime);
        }
        return runtime.app.handle(request);
      }
      return env.ASSETS.fetch(request);
    }
  };
}

export default createWorker();
