import { expect, test } from "bun:test";
import { applicationSessionCookie, clearCsrfCookie, clearSessionCookie, csrfCookie, decodeAuthSessionCookie, encodeAuthSessionCookie, readCookie, sessionCookie } from "../src/http";

test("session cookies carry the configured browser policy", () => {
  const cookie = sessionCookie("aevo_session", "token value", new Date("2030-01-01T00:00:00Z"), true, "none");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=None");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("token%20value");
  expect(clearSessionCookie("aevo_session", true, "none")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
});

test("malformed cookie values fail closed", () => {
  const request = new Request("http://localhost", { headers: { cookie: "aevo_session=%E0%A4%A" } });
  expect(readCookie(request, "aevo_session")).toBeNull();
  expect(decodeAuthSessionCookie("{not-json")).toBeNull();
  const encoded = encodeAuthSessionCookie({ accessToken: "access", refreshToken: "refresh" });
  expect(decodeAuthSessionCookie(encoded)).toEqual({ accessToken: "access", refreshToken: "refresh" });
});

test("Core app sessions are browser-session cookies unless remember is explicit", () => {
  const expiry = new Date("2030-01-01T00:00:00Z");
  const transient = applicationSessionCookie("aevo_pos_session", "s".repeat(48), expiry, true, "lax");
  expect(transient).not.toContain("Max-Age=");
  expect(transient).not.toContain("Expires=");
  expect(transient).toContain("HttpOnly");
  expect(transient).toContain("Secure");

  const persistent = applicationSessionCookie("aevo_pos_session", "s".repeat(48), expiry, true, "lax", true);
  expect(persistent).toContain("Max-Age=");
  expect(persistent).toContain("Expires=");
  expect(csrfCookie("aevo_pos_csrf", "c".repeat(48), expiry, true, "lax")).not.toContain("HttpOnly");
  expect(clearCsrfCookie("aevo_pos_csrf", true, "lax")).toContain("Max-Age=0");
});
