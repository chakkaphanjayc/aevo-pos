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
