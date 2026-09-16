import { describe, expect, test } from "bun:test";
import type { AppConfig } from "@aevo/config";
import type { Database } from "@aevo/db";
import { createApp } from "../src/app";

const config: AppConfig = {
  nodeEnv: "test", apiHost: "127.0.0.1", apiPort: 3001, webOrigin: "http://localhost:4321",
  databaseUrl: "postgres://unused/test", sessionCookieName: "aevo_session", sessionTtlHours: 1, logLevel: "error"
};

const fakeSql = ((() => Promise.resolve([{ ready: 1 }])) as unknown) as Database;
const fakeAuth = {
  login: async () => ({ token: "secret", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  logout: async () => undefined,
  resolve: async () => null
};

describe("API foundation", () => {
  const app = createApp({ config, sql: fakeSql, auth: fakeAuth });

  test("health includes a correlation id", async () => {
    const response = await app.handle(new Request("http://localhost/health", { headers: { "x-request-id": "request-123" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(await response.json()).toMatchObject({ status: "ok", requestId: "request-123" });
  });

  test("protected routes reject anonymous callers", async () => {
    const response = await app.handle(new Request("http://localhost/api/auth/me"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  test("login writes an http-only cookie", async () => {
    const response = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "correct-password" })
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });
});
