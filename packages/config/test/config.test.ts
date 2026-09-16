import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src";

describe("loadConfig", () => {
  test("validates and normalizes environment", () => {
    const config = loadConfig({ WEB_ORIGIN: "http://localhost:4321", DATABASE_URL: "postgres://db/app" });
    expect(config.apiPort).toBe(3001);
    expect(config.sessionTtlHours).toBe(168);
  });

  test("rejects missing database configuration", () => {
    expect(() => loadConfig({ WEB_ORIGIN: "http://localhost:4321" })).toThrow("DATABASE_URL");
  });
});
