import type { Database } from "@aevo/db";
import { createSession, findActiveUserByEmail, resolvePrincipal, revokeSession } from "@aevo/db";
import { generateSessionToken, hashSessionToken, sessionExpiresAt, verifyPassword } from "./session";

export class AuthenticationError extends Error {
  readonly code = "INVALID_CREDENTIALS";
  constructor() { super("Email or password is incorrect"); this.name = "AuthenticationError"; }
}

export class AuthService {
  constructor(private readonly database: Database, private readonly sessionTtlHours: number) {}

  async login(input: { email: string; password: string; ipAddress?: string; userAgent?: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await findActiveUserByEmail(this.database, email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new AuthenticationError();
    const token = generateSessionToken();
    const expiresAt = sessionExpiresAt(this.sessionTtlHours);
    await createSession(this.database, {
      userId: user.id, tokenHash: hashSessionToken(token), expiresAt,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {})
    });
    return { token, expiresAt };
  }

  resolve(token: string, organizationId?: string) { return resolvePrincipal(this.database, hashSessionToken(token), organizationId); }
  logout(token: string) { return revokeSession(this.database, hashSessionToken(token)); }
}
