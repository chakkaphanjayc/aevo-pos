import { describe, expect, test } from "bun:test";
import type { AppConfig } from "@aevo/config";
import type { SessionPrincipal } from "@aevo/contracts";
import type { Database } from "@aevo/db";
import { createApp } from "../src/app";

const config: AppConfig = {
  nodeEnv: "test", apiHost: "127.0.0.1", apiPort: 3001, webOrigin: "http://localhost:4321",
  mongodbUri: "mongodb://unused/test", mongodbDatabase: "aevo_test",
  sessionCookieName: "aevo_session", sessionTtlHours: 1, logLevel: "error"
};

const fakeDatabase = { ping: async () => undefined } as unknown as Database;
const principal: SessionPrincipal = {
  userId: "user-1", email: "owner@example.com", displayName: "Aevo Owner",
  organizationId: "org-1", membershipId: "membership-1", role: "OWNER",
  permissions: ["store.read"]
};
const fakeAuth = {
  login: async () => ({ token: "secret", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  logout: async () => undefined,
  resolve: async (token: string) => token === "secret" ? principal : null
};

describe("API foundation", () => {
  const app = createApp({ config, database: fakeDatabase, auth: fakeAuth });

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

  test("readiness checks MongoDB connectivity", async () => {
    const response = await app.handle(new Request("http://localhost/ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready" });
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

  test("authenticated session can be resolved and logged out", async () => {
    const me = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { cookie: "aevo_session=secret" }
    }));
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: principal });

    const logout = await app.handle(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { cookie: "aevo_session=secret" }
    }));
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("rejects credentialed mutations from an untrusted origin", async () => {
    const response = await app.handle(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { origin: "https://attacker.example" }
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });
  });
});
