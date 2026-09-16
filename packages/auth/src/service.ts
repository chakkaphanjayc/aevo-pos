import type { Database } from "@aevo/db";
import { createSession, findActiveUserByEmail, resolvePrincipal, revokeSession } from "@aevo/db";
import { generateSessionToken, hashSessionToken, sessionExpiresAt, verifyPassword } from "./session";

export class AuthenticationError extends Error {
  readonly code = "INVALID_CREDENTIALS";
  constructor() { super("Email or password is incorrect"); this.name = "AuthenticationError"; }
}

export class AuthService {
  constructor(private readonly sql: Database, private readonly sessionTtlHours: number) {}

  async login(input: { email: string; password: string; ipAddress?: string; userAgent?: string }) {
    const user = await findActiveUserByEmail(this.sql, input.email.trim().toLowerCase());
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new AuthenticationError();
    const token = generateSessionToken();
    const expiresAt = sessionExpiresAt(this.sessionTtlHours);
    await createSession(this.sql, {
      userId: user.id, tokenHash: hashSessionToken(token), expiresAt,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {})
    });
    return { token, expiresAt };
  }

  resolve(token: string, organizationId?: string) { return resolvePrincipal(this.sql, hashSessionToken(token), organizationId); }
  logout(token: string) { return revokeSession(this.sql, hashSessionToken(token)); }
}
