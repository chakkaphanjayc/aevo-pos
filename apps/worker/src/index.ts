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
  AEVO_ACCOUNTS_API_URL?: string;
  AEVO_ACCOUNTS_EXCHANGE_SECRET?: string;
  SESSION_COOKIE_NAME?: string;
  SESSION_COOKIE_SAME_SITE?: "lax" | "strict" | "none";
  LOG_LEVEL?: "debug" | "info" | "warn" | "error";
  ASSETS: WorkerAssets;
}

export interface WorkerRuntime {
  app: { handle(request: Request): Promise<Response> };
  database: Database;
}

function requestIdFor(request: Request): string {
  return request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
}

/**
 * Map tenant-scoped public URLs to build-time shell assets. Store codes and
 * customer tokens are runtime data, so Astro cannot pre-render every URL.
 * The browser URL stays unchanged while ASSETS serves the correct shell.
 */
function publicShellRequest(request: Request): Request {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

  if (parts[0] === "order" && parts.length === 2) {
    url.pathname = "/order/__runtime__/";
  } else if (parts[0] === "order" && parts.length === 4 && parts[2] === "table") {
    url.pathname = "/order/__runtime__/";
    url.searchParams.set("table", parts[3] ?? "");
  } else if (parts[0] === "order" && parts.length === 4 && parts[2] === "track") {
    url.pathname = "/order/track/";
    url.search = "";
    url.searchParams.set("storeCode", parts[1] ?? "");
    url.searchParams.set("token", parts[3] ?? "");
  } else if (parts[0] === "order" && parts.length === 4 && parts[2] === "receipt") {
    url.pathname = "/order/receipt/";
    url.search = "";
    url.searchParams.set("storeCode", parts[1] ?? "");
    url.searchParams.set("token", parts[3] ?? "");
  } else if (parts[0] === "kiosk" && parts.length === 2) {
    url.pathname = "/kiosk/__runtime__/";
  } else if (parts[0] === "queue" && parts.length === 2) {
    url.pathname = "/queue/__runtime__/";
  }

  return new Request(url, request);
}

function runtimeErrorResponse(requestId: string, status: 500 | 503): Response {
  return new Response(JSON.stringify({
    error: {
      code: "RUNTIME_NOT_CONFIGURED",
      message: "The service is not configured. Check the Worker environment variables.",
      requestId
    }
  }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId
    }
  });
}

function createRuntime(env: WorkerEnv): WorkerRuntime {
  const supabaseKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey) throw new Error("SUPABASE_SECRET_KEY is not configured");
  const config = loadConfig({
    NODE_ENV: "production",
    API_HOST: "0.0.0.0",
    API_PORT: "8787",
    WEB_ORIGIN: env.WEB_ORIGIN,
    AEVO_ACCOUNTS_API_URL: env.AEVO_ACCOUNTS_API_URL,
    AEVO_ACCOUNTS_EXCHANGE_SECRET: env.AEVO_ACCOUNTS_EXCHANGE_SECRET,
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
      const requestId = requestIdFor(request);

      // Liveness must stay available even while a deployment is missing its
      // Supabase variables. Readiness and API requests still require a fully
      // initialized runtime and return a diagnosable JSON response instead of
      // an opaque Cloudflare 1101 exception.
      if (pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", service: "aevo-api", requestId }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-request-id": requestId
          }
        });
      }

      if (pathname.startsWith("/api/") || pathname === "/ready") {
        let runtime = runtimes.get(env as object);
        if (!runtime) {
          try {
            runtime = runtimeFactory(env);
            runtimes.set(env as object, runtime);
          } catch (error) {
            // Keep the detailed configuration error in Worker logs without
            // reflecting environment names or secrets to the browser.
            console.error("aevo.worker.runtime_init_failed", {
              requestId,
              message: error instanceof Error ? error.message : String(error)
            });
            return runtimeErrorResponse(requestId, pathname === "/ready" ? 503 : 503);
          }
        }
        return runtime.app.handle(request);
      }
      return env.ASSETS.fetch(publicShellRequest(request));
    }
  };
}

export default createWorker();
