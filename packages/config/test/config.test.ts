import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src";

describe("loadConfig", () => {
  test("validates and normalizes environment", () => {
    const config = loadConfig({ WEB_ORIGIN: "http://localhost:4321", MONGODB_URI: "mongodb://db/app" });
    expect(config.apiPort).toBe(3001);
    expect(config.mongodbDatabase).toBe("aevo");
    expect(config.sessionTtlHours).toBe(168);
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
});
