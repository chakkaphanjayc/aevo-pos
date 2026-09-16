import { expect, test } from "bun:test";
import { generateSessionToken, hashSessionToken, sessionExpiresAt } from "../src";

test("session tokens are opaque and only hashes need persistence", () => {
  const first = generateSessionToken();
  const second = generateSessionToken();
  expect(first).not.toBe(second);
  expect(hashSessionToken(first)).toHaveLength(64);
  expect(hashSessionToken(first)).not.toBe(first);
});

test("session expiry is deterministic", () => {
  expect(sessionExpiresAt(1, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-01-01T01:00:00.000Z");
});
