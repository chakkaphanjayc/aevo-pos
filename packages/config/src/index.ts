export type NodeEnvironment = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  apiHost: string;
  apiPort: number;
  webOrigin: string;
  databaseUrl: string;
  sessionCookieName: string;
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

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV is invalid");
  const logLevel = source.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new Error("LOG_LEVEL is invalid");
  const webOrigin = required(source, "WEB_ORIGIN");
  const databaseUrl = required(source, "DATABASE_URL");
  try { new URL(webOrigin); new URL(databaseUrl); } catch { throw new Error("WEB_ORIGIN and DATABASE_URL must be valid URLs"); }
  return {
    nodeEnv: nodeEnv as NodeEnvironment,
    apiHost: source.API_HOST ?? "0.0.0.0",
    apiPort: positiveInteger(source.API_PORT ?? "3001", "API_PORT"),
    webOrigin,
    databaseUrl,
    sessionCookieName: source.SESSION_COOKIE_NAME ?? "aevo_session",
    sessionTtlHours: positiveInteger(source.SESSION_TTL_HOURS ?? "168", "SESSION_TTL_HOURS"),
    logLevel: logLevel as LogLevel
  };
}
