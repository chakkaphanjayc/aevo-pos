import type { ApplicationCode } from "@aevo/contracts";
import type { Database } from "@aevo/db";

export interface ApplicationSessionCookie { sessionToken: string; }

export function isApplicationSessionCookie(value: unknown): value is ApplicationSessionCookie {
  return Boolean(value && typeof value === "object" && typeof (value as ApplicationSessionCookie).sessionToken === "string" && /^[A-Za-z0-9_-]{40,}$/.test((value as ApplicationSessionCookie).sessionToken));
}

export interface ManagedApplicationSession {
  id: string;
  userId: string;
  sessionToken: string;
  csrfTokenHash: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
}

export interface ApplicationSessionCredentials {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  csrf_token_hash: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  last_seen_at: string;
  access_expires_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  app_code: ApplicationCode;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export class ApplicationSessionError extends Error {
  readonly code = "APPLICATION_SESSION_ERROR";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplicationSessionError";
  }
}

export class ApplicationSessionManager {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(
    private readonly database: Database,
    secret: string,
    private readonly options: { applicationCode: ApplicationCode; idleTimeoutSeconds: number; absoluteTimeoutSeconds: number }
  ) {
    this.keyPromise = this.createKey(secret);
  }

  private async createKey(secret: string): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  private async encrypt(value: string): Promise<string> {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.keyPromise, new TextEncoder().encode(value));
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.length);
    return bytesToBase64Url(result);
  }

  private async decrypt(value: string): Promise<string> {
    const encoded = base64UrlToBytes(value);
    if (encoded.length <= 12) throw new ApplicationSessionError("Invalid encrypted session token");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: encoded.slice(0, 12) }, await this.keyPromise, encoded.slice(12));
    return new TextDecoder().decode(plaintext);
  }

  async create(credentials: ApplicationSessionCredentials, metadata: { ipAddress?: string; userAgent?: string } = {}): Promise<{ session: ManagedApplicationSession; csrfToken: string }> {
    const now = new Date();
    return this.createAt(credentials, metadata, new Date(now.getTime() + this.options.absoluteTimeoutSeconds * 1000), now);
  }

  private async createAt(credentials: ApplicationSessionCredentials, metadata: { ipAddress?: string; userAgent?: string }, absoluteExpiresAt: Date, now: Date): Promise<{ session: ManagedApplicationSession; csrfToken: string }> {
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const accessExpiresAt = new Date(Math.min(credentials.expiresAt.getTime(), absoluteExpiresAt.getTime()));
    const idleExpiresAt = new Date(Math.min(absoluteExpiresAt.getTime(), now.getTime() + this.options.idleTimeoutSeconds * 1000));
    const [tokenHash, csrfTokenHash, accessTokenCiphertext, refreshTokenCiphertext] = await Promise.all([
      sha256(sessionToken), sha256(csrfToken), this.encrypt(credentials.accessToken), this.encrypt(credentials.refreshToken)
    ]);
    const result = await this.database.client.from("app_sessions").insert({
      user_id: credentials.userId,
      app_code: this.options.applicationCode,
      token_hash: tokenHash,
      csrf_token_hash: csrfTokenHash,
      access_token_ciphertext: accessTokenCiphertext,
      refresh_token_ciphertext: refreshTokenCiphertext,
      user_agent: metadata.userAgent?.slice(0, 512) ?? null,
      ip_address: metadata.ipAddress?.slice(0, 128) ?? null,
      last_seen_at: now.toISOString(),
      access_expires_at: accessExpiresAt.toISOString(),
      idle_expires_at: idleExpiresAt.toISOString(),
      absolute_expires_at: absoluteExpiresAt.toISOString()
    }).select("id").single();
    if (result.error || !result.data) throw new ApplicationSessionError(`Application session creation failed: ${result.error?.message ?? "missing session id"}`, { cause: result.error ?? undefined });
    return {
      csrfToken,
      session: { id: String(result.data.id), userId: credentials.userId, sessionToken, csrfTokenHash, accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, accessExpiresAt, idleExpiresAt, absoluteExpiresAt, lastSeenAt: now }
    };
  }

  async resolve(sessionToken: string): Promise<ManagedApplicationSession | null> {
    if (!/^[A-Za-z0-9_-]{40,}$/.test(sessionToken)) return null;
    const result = await this.database.client.from("app_sessions")
      .select("id,user_id,csrf_token_hash,access_token_ciphertext,refresh_token_ciphertext,last_seen_at,access_expires_at,idle_expires_at,absolute_expires_at,revoked_at,app_code")
      .eq("token_hash", await sha256(sessionToken)).eq("app_code", this.options.applicationCode).maybeSingle();
    if (result.error) throw new ApplicationSessionError(`Application session lookup failed: ${result.error.message}`, { cause: result.error });
    const row = result.data as SessionRow | null;
    if (!row || row.revoked_at) return null;
    if (Date.now() >= Date.parse(row.idle_expires_at) || Date.now() >= Date.parse(row.absolute_expires_at)) {
      await this.revokeById(row.id);
      return null;
    }
    const [accessToken, refreshToken] = await Promise.all([this.decrypt(row.access_token_ciphertext), this.decrypt(row.refresh_token_ciphertext)]);
    const now = new Date();
    const lastSeenAt = new Date(row.last_seen_at);
    const shouldTouch = now.getTime() - lastSeenAt.getTime() >= 5 * 60 * 1000;
    const idleExpiresAt = new Date(Math.min(Date.parse(row.absolute_expires_at), now.getTime() + this.options.idleTimeoutSeconds * 1000));
    if (shouldTouch) {
      const touched = await this.database.client.from("app_sessions").update({ last_seen_at: now.toISOString(), idle_expires_at: idleExpiresAt.toISOString() }).eq("id", row.id).is("revoked_at", null);
      if (touched.error) throw new ApplicationSessionError(`Application session touch failed: ${touched.error.message}`, { cause: touched.error });
    }
    return { id: row.id, userId: row.user_id, sessionToken, csrfTokenHash: row.csrf_token_hash, accessToken, refreshToken, accessExpiresAt: new Date(row.access_expires_at), idleExpiresAt, absoluteExpiresAt: new Date(row.absolute_expires_at), lastSeenAt: shouldTouch ? now : lastSeenAt };
  }

  private async revokeById(id: string): Promise<boolean> {
    const result = await this.database.client.from("app_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select("id").maybeSingle();
    if (result.error) throw new ApplicationSessionError(`Application session revoke failed: ${result.error.message}`, { cause: result.error });
    return Boolean(result.data);
  }

  async revoke(sessionToken: string): Promise<void> {
    const result = await this.database.client.from("app_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", await sha256(sessionToken)).eq("app_code", this.options.applicationCode).is("revoked_at", null);
    if (result.error) throw new ApplicationSessionError(`Application session revoke failed: ${result.error.message}`, { cause: result.error });
  }

  async rotate(current: ManagedApplicationSession, credentials: ApplicationSessionCredentials, metadata: { ipAddress?: string; userAgent?: string } = {}): Promise<{ session: ManagedApplicationSession; csrfToken: string }> {
    const replacement = await this.createAt(credentials, metadata, current.absoluteExpiresAt, new Date());
    const linked = await this.database.client.from("app_sessions").update({ revoked_at: new Date().toISOString(), replaced_by: replacement.session.id }).eq("id", current.id).is("revoked_at", null).select("id").maybeSingle();
    if (linked.error) throw new ApplicationSessionError(`Application session rotation link failed: ${linked.error.message}`, { cause: linked.error });
    if (!linked.data) {
      await this.revokeById(replacement.session.id);
      throw new ApplicationSessionError("Application session rotation was already completed");
    }
    return replacement;
  }

  async verifyCsrf(session: ManagedApplicationSession, token: string | null): Promise<boolean> {
    return Boolean(token && session.csrfTokenHash === await sha256(token));
  }
}
