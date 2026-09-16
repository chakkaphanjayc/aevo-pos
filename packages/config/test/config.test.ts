import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src";

describe("loadConfig", () => {
  test("validates and normalizes environment", () => {
    const config = loadConfig({ WEB_ORIGIN: "http://localhost:4321", MONGODB_URI: "mongodb://db/app" });
    expect(config.apiPort).toBe(3001);
    expect(config.mongodbDatabase).toBe("aevo");
    expect(config.sessionTtlHours).toBe(168);
    expect(config.sessionCookieSameSite).toBe("lax");
  });

  test("rejects missing database configuration", () => {
    expect(() => loadConfig({ WEB_ORIGIN: "http://localhost:4321" })).toThrow("MONGODB_URI");
  });

  test("rejects non-MongoDB connection URLs", () => {
    expect(() => loadConfig({ WEB_ORIGIN: "http://localhost:4321", MONGODB_URI: "postgres://db/app" })).toThrow("MONGODB_URI");
  });

  test("validates the MongoDB database name", () => {
    expect(() => loadConfig({
      WEB_ORIGIN: "http://localhost:4321",
      MONGODB_URI: "mongodb://db/app",
      MONGODB_DATABASE: "bad/name"
    })).toThrow("MONGODB_DATABASE");
  });

  test("validates the session cookie policy and name", () => {
    const config = loadConfig({
      WEB_ORIGIN: "http://localhost:4321",
      MONGODB_URI: "mongodb://db/app",
      SESSION_COOKIE_SAME_SITE: "strict",
      SESSION_COOKIE_NAME: "aevo_staff"
    });
    expect(config.sessionCookieSameSite).toBe("strict");
    expect(config.sessionCookieName).toBe("aevo_staff");
    expect(() => loadConfig({
      WEB_ORIGIN: "http://localhost:4321",
      MONGODB_URI: "mongodb://db/app",
      SESSION_COOKIE_SAME_SITE: "cross-site"
    })).toThrow("SESSION_COOKIE_SAME_SITE");
    expect(() => loadConfig({
      WEB_ORIGIN: "http://localhost:4321",
      MONGODB_URI: "mongodb://db/app",
      SESSION_COOKIE_SAME_SITE: "none"
    })).toThrow("NODE_ENV=production");
  });
});
