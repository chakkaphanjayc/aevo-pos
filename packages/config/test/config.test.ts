import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src";

const base = {
  WEB_ORIGIN: "http://localhost:4321",
  SUPABASE_URL: "https://demo.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret"
};

describe("loadConfig", () => {
  test("validates and normalizes Supabase environment", () => {
    const config = loadConfig({ ...base, WEB_ORIGIN: "http://localhost:4321/" });
    expect(config.apiPort).toBe(3001);
    expect(config.webOrigin).toBe("http://localhost:4321");
    expect(config.supabaseUrl).toBe("https://demo.supabase.co");
    expect(config.supabaseKey).toBe("server-secret");
    expect(config.sessionCookieSameSite).toBe("lax");
  });

  test("accepts the legacy service-role secret name", () => {
    const config = loadConfig({ WEB_ORIGIN: base.WEB_ORIGIN, SUPABASE_URL: base.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "legacy-secret" });
    expect(config.supabaseKey).toBe("legacy-secret");
  });

  test("rejects missing database configuration", () => {
    expect(() => loadConfig({ WEB_ORIGIN: base.WEB_ORIGIN })).toThrow("SUPABASE_URL");
    expect(() => loadConfig({ WEB_ORIGIN: base.WEB_ORIGIN, SUPABASE_URL: base.SUPABASE_URL })).toThrow("SUPABASE_SECRET_KEY");
  });

  test("allows credential-free local test mode", () => {
    const config = loadConfig({ NODE_ENV: "development", AEVO_TEST_MODE: "1", SUPABASE_URL: "https://real-project.supabase.co", SUPABASE_SECRET_KEY: "real-secret" });
    expect(config.testMode).toBe(true);
    expect(config.webOrigin).toBe("http://localhost:4332");
    expect(config.apiPort).toBe(3003);
    expect(config.supabaseUrl).toBe("http://aevo-test-mode.invalid");
    expect(config.supabaseKey).toBe("aevo-test-mode-secret");
  });

  test("rejects test mode in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", WEB_ORIGIN: "https://pos.example.com", AEVO_TEST_MODE: "1" })).toThrow("AEVO_TEST_MODE");
  });

  test("rejects non-HTTP Supabase URLs", () => {
    expect(() => loadConfig({ ...base, SUPABASE_URL: "postgres://db/app" })).toThrow("SUPABASE_URL");
  });

  test("validates the session cookie policy and name", () => {
    const config = loadConfig({ ...base, SESSION_COOKIE_SAME_SITE: "strict", SESSION_COOKIE_NAME: "aevo_staff" });
    expect(config.sessionCookieSameSite).toBe("strict");
    expect(config.sessionCookieName).toBe("aevo_staff");
    expect(() => loadConfig({ ...base, SESSION_COOKIE_SAME_SITE: "cross-site" })).toThrow("SESSION_COOKIE_SAME_SITE");
    expect(() => loadConfig({ ...base, SESSION_COOKIE_SAME_SITE: "none" })).toThrow("NODE_ENV=production");
  });
});
