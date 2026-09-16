export type NodeEnvironment = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type SessionCookieSameSite = "lax" | "strict" | "none";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  apiHost: string;
  apiPort: number;
  webOrigin: string;
  mongodbUri: string;
  mongodbDatabase: string;
  sessionCookieName: string;
  /** Cookie policy used by the browser session. Defaults to lax. */
  sessionCookieSameSite?: SessionCookieSameSite;
  sessionTtlHours: number;
  logLevel: LogLevel;
}

function required(source: Record<string, string | undefined>, key: string): string {
  const value = source[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function positiveInteger(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
  return parsed;
}

function sessionCookieSameSite(value: string): SessionCookieSameSite {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "lax" && normalized !== "strict" && normalized !== "none") {
    throw new Error("SESSION_COOKIE_SAME_SITE must be lax, strict, or none");
  }
  return normalized;
}

function sessionCookieName(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(normalized)) {
    throw new Error("SESSION_COOKIE_NAME contains invalid characters");
  }
  return normalized;
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV is invalid");
  const logLevel = source.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new Error("LOG_LEVEL is invalid");
  const webOrigin = required(source, "WEB_ORIGIN");
  const mongodbUri = required(source, "MONGODB_URI");
  const mongodbDatabase = source.MONGODB_DATABASE?.trim() || "aevo";
  try {
    new URL(webOrigin);
    const parsedMongoUri = new URL(mongodbUri);
    if (parsedMongoUri.protocol !== "mongodb:" && parsedMongoUri.protocol !== "mongodb+srv:") {
      throw new Error("invalid MongoDB protocol");
    }
  } catch {
    throw new Error("WEB_ORIGIN and MONGODB_URI must be valid URLs");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(mongodbDatabase)) {
    throw new Error("MONGODB_DATABASE must be a valid database name");
  }
  const configuredCookieSameSite = sessionCookieSameSite(source.SESSION_COOKIE_SAME_SITE ?? "lax");
  if (configuredCookieSameSite === "none" && nodeEnv !== "production") {
    throw new Error("SESSION_COOKIE_SAME_SITE=none requires NODE_ENV=production and HTTPS");
  }
  return {
    nodeEnv: nodeEnv as NodeEnvironment,
    apiHost: source.API_HOST ?? "0.0.0.0",
    apiPort: positiveInteger(source.API_PORT ?? "3001", "API_PORT"),
    webOrigin,
    mongodbUri,
    mongodbDatabase,
    sessionCookieName: sessionCookieName(source.SESSION_COOKIE_NAME ?? "aevo_session"),
    sessionCookieSameSite: configuredCookieSameSite,
    sessionTtlHours: positiveInteger(source.SESSION_TTL_HOURS ?? "168", "SESSION_TTL_HOURS"),
    logLevel: logLevel as LogLevel
  };
}
