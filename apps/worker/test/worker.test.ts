import { expect, test } from "bun:test";
import { createWorker } from "../src";

const assets = { fetch: async () => new Response("asset", { status: 200 }) };
const env = {
  SUPABASE_URL: "https://demo.supabase.co",
  WEB_ORIGIN: "http://localhost:8787",
  ASSETS: assets
};

test("Worker routes API paths to Elysia and everything else to assets", async () => {
  let apiCalls = 0;
  const worker = createWorker(() => ({
    app: { handle: async () => { apiCalls += 1; return new Response("api", { status: 200 }); } },
    database: {} as never
  }));
  const apiResponse = await worker.fetch(new Request("http://localhost:8787/api/auth/me"), env);
  expect(apiResponse.status).toBe(200);
  expect(await apiResponse.text()).toBe("api");
  expect(apiCalls).toBe(1);

  const assetResponse = await worker.fetch(new Request("http://localhost:8787/login"), env);
  expect(assetResponse.status).toBe(200);
  expect(await assetResponse.text()).toBe("asset");
});

test("health remains a liveness check when runtime configuration is missing", async () => {
  let runtimeCalls = 0;
  const worker = createWorker(() => {
    runtimeCalls += 1;
    throw new Error("Missing required environment variable: SUPABASE_URL");
  });
  const response = await worker.fetch(new Request("http://localhost:8787/health", {
    headers: { "x-request-id": "health-request" }
  }), {} as never);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toBe("health-request");
  expect(await response.json()).toMatchObject({ status: "ok", requestId: "health-request" });
  expect(runtimeCalls).toBe(0);
});

test("readiness returns a structured configuration error instead of a Worker 1101", async () => {
  const worker = createWorker(() => {
    throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
  });
  const response = await worker.fetch(new Request("http://localhost:8787/ready", {
    headers: { "x-request-id": "ready-request" }
  }), {} as never);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error: { code: "RUNTIME_NOT_CONFIGURED", requestId: "ready-request" }
  });
});
