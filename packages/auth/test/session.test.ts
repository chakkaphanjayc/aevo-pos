import { expect, test } from "bun:test";
import { isAuthSessionCookie } from "../src";

test("accepts a Supabase access/refresh token pair", () => {
  expect(isAuthSessionCookie({ accessToken: "access", refreshToken: "refresh" })).toBeTrue();
  expect(isAuthSessionCookie({ accessToken: "access" })).toBeTrue();
});

test("rejects malformed session cookie payloads", () => {
  expect(isAuthSessionCookie(null)).toBeFalse();
  expect(isAuthSessionCookie({ accessToken: "" })).toBeFalse();
  expect(isAuthSessionCookie({ accessToken: 123 })).toBeFalse();
  expect(isAuthSessionCookie({ accessToken: "access", refreshToken: 123 })).toBeFalse();
});
