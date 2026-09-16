import { expect, test } from "bun:test";
import type { Database } from "@aevo/db";
import { AuthService, AuthenticationError } from "@aevo/auth";

function database(auth: Record<string, unknown>): Database {
  return {
    client: { auth } as never,
    ping: async () => undefined,
    close: async () => undefined
  };
}

test("Supabase Auth adapter returns an HttpOnly-ready token pair", async () => {
  const service = new AuthService(database({
    signInWithPassword: async () => ({
      data: {
        user: { id: "user-1" },
        session: { access_token: "access", refresh_token: "refresh", expires_at: 1_798_000_000 }
      },
      error: null
    })
  }));
  const result = await service.login({ email: "OWNER@EXAMPLE.COM", password: "correct horse battery staple" });
  expect(result.accessToken).toBe("access");
  expect(result.refreshToken).toBe("refresh");
  expect(result.expiresAt).toEqual(new Date(1_798_000_000 * 1000));
});

test("Supabase Auth errors become generic authentication errors", async () => {
  const service = new AuthService(database({
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: "Invalid login credentials" } })
  }));
  await expect(service.login({ email: "owner@example.com", password: "bad" })).rejects.toBeInstanceOf(AuthenticationError);
});

test("Supabase refresh rotates both tokens", async () => {
  const service = new AuthService(database({
    refreshSession: async ({ refresh_token }: { refresh_token: string }) => ({
      data: {
        user: { id: "user-1" },
        session: { access_token: `access-${refresh_token}`, refresh_token: "refresh-next", expires_at: 1_798_000_100 }
      },
      error: null
    })
  }));
  const result = await service.refresh("refresh");
  expect(result.accessToken).toBe("access-refresh");
  expect(result.refreshToken).toBe("refresh-next");
});
