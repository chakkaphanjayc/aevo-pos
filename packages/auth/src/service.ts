import type { Database } from "@aevo/db";
import { resolvePrincipal } from "@aevo/db";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export class AuthenticationError extends Error {
  readonly code = "INVALID_CREDENTIALS";
  constructor() {
    super("Email or password is incorrect");
    this.name = "AuthenticationError";
  }
}

/**
 * Supabase Auth adapter used by the API. Password verification, JWT signing,
 * refresh-token rotation and account lockout remain inside Supabase Auth.
 */
export class AuthService {
  constructor(private readonly database: Database) {}

  private get authClient() {
    return this.database.authClient ?? this.database.client;
  }

  async login(input: { email: string; password: string; ipAddress?: string; userAgent?: string }): Promise<AuthSession> {
    // IP/user-agent are accepted by the domain interface for audit integrations;
    // Supabase Auth applies its own request metadata and rate limits here.
    void input.ipAddress;
    void input.userAgent;
    const { data, error } = await this.authClient.auth.signInWithPassword({
      email: input.email.trim().toLowerCase(),
      password: input.password
    });
    if (error || !data.session || !data.user) throw new AuthenticationError();

    const expiresAt = data.session.expires_at
      ? new Date(data.session.expires_at * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt
    };
  }

  async resolve(accessToken: string, organizationId?: string) {
    if (!accessToken) return null;
    const { data, error } = await this.authClient.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return resolvePrincipal(this.database, data.user.id, organizationId);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    if (!refreshToken) throw new AuthenticationError();
    const { data, error } = await this.authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) throw new AuthenticationError();
    const expiresAt = data.session.expires_at
      ? new Date(data.session.expires_at * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt
    };
  }

  async logout(accessToken: string): Promise<void> {
    if (!accessToken) return;
    // Access tokens are short-lived JWTs. Revoking the Supabase user sessions
    // also invalidates refresh tokens when the admin API is available.
    const userResult = await this.authClient.auth.getUser(accessToken);
    if (userResult.error || !userResult.data.user) return;
    const { error } = await this.authClient.auth.admin.signOut(userResult.data.user.id, "global");
    if (error) throw new Error(`Supabase logout failed: ${error.message}`);
  }
}
