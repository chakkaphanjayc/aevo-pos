import { expect, test } from "bun:test";
import { createDatabase } from "../src";

test("Supabase database adapter performs a readiness query", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push(new Request(input, init));
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const database = createDatabase("https://demo.supabase.co", "server-secret");
    await database.ping();
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/rest/v1/organizations");
    expect(new URL(requests[0]!.url).search).toContain("select=id");
    expect(requests[0]!.headers.get("apikey")).toBe("server-secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
