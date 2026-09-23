export type NodeEnvironment = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type SessionCookieSameSite = "lax" | "strict" | "none";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  /** Local-only in-memory workspace for UI and flow testing. */
  testMode?: boolean;
  applicationCode?: "POS";
  apiHost: string;
  apiPort: number;
  webOrigin: string;
  modernWebOrigin?: string;
  hubWebOrigin?: string;
  coreApiOrigin?: string;
  coreApiServiceSecret?: string;
  accountsApiOrigin?: string;
  accountsExchangeSecret?: string;
  /** Supabase project URL (for example https://<project>.supabase.co). */
  supabaseUrl: string;
  /** Server-only Supabase secret/service-role key. Never send this to browsers. */
  supabaseKey: string;
  sessionCookieName: string;
  sessionCookieSecret?: string;
  sessionIdleTimeoutSeconds?: number;
  sessionAbsoluteTimeoutSeconds?: number;
  csrfCookieName?: string;
  /** Cookie policy used by the browser session. Defaults to lax. */
  sessionCookieSameSite?: SessionCookieSameSite;
  logLevel: LogLevel;
  stripeSecretKey?: string | undefined;
  stripeWebhookSecret?: string | undefined;
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

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV is invalid");
  const logLevel = source.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new Error("LOG_LEVEL is invalid");
  const testMode = enabled(source.AEVO_TEST_MODE);
  if (testMode && nodeEnv === "production") {
    throw new Error("AEVO_TEST_MODE is only allowed when NODE_ENV is development or test");
  }
  const webOrigin = source.WEB_ORIGIN?.trim() || (testMode ? "http://localhost:4332" : required(source, "WEB_ORIGIN"));
  const supabaseUrl = testMode ? "http://aevo-test-mode.invalid" : source.SUPABASE_URL?.trim() || required(source, "SUPABASE_URL");
  // SUPABASE_SERVICE_ROLE_KEY is accepted for existing deployments. New
  // deployments should use SUPABASE_SECRET_KEY, which is the current key
  // name in Supabase's API-key model.
  const configuredSupabaseKey = source.SUPABASE_SECRET_KEY?.trim() || source.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabaseKey = testMode ? "aevo-test-mode-secret" : configuredSupabaseKey;
  if (!supabaseKey) throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
  let normalizedWebOrigin: string;
  let normalizedSupabaseUrl: string;
  try {
    const parsedWebOrigin = new URL(webOrigin);
    if (parsedWebOrigin.protocol !== "https:" && parsedWebOrigin.protocol !== "http:") throw new Error("invalid web protocol");
    const parsedSupabaseUrl = new URL(supabaseUrl);
    if (parsedSupabaseUrl.protocol !== "https:" && parsedSupabaseUrl.protocol !== "http:") {
      throw new Error("invalid Supabase protocol");
    }
    normalizedWebOrigin = parsedWebOrigin.origin;
    normalizedSupabaseUrl = parsedSupabaseUrl.toString().replace(/\/$/, "");
  } catch {
    throw new Error("WEB_ORIGIN and SUPABASE_URL must be valid URLs");
  }
  const configuredCookieSameSite = sessionCookieSameSite(source.SESSION_COOKIE_SAME_SITE ?? "lax");
  if (configuredCookieSameSite === "none" && nodeEnv !== "production") {
    throw new Error("SESSION_COOKIE_SAME_SITE=none requires NODE_ENV=production and HTTPS");
  }
  return {
    nodeEnv: nodeEnv as NodeEnvironment,
    testMode,
    applicationCode: "POS",
    apiHost: source.API_HOST ?? "0.0.0.0",
    apiPort: positiveInteger(testMode ? (source.AEVO_TEST_API_PORT ?? "3003") : source.API_PORT ?? "3001", "API_PORT"),
    webOrigin: normalizedWebOrigin!,
    ...(source.MODERN_WEB_ORIGIN?.trim() ? { modernWebOrigin: new URL(source.MODERN_WEB_ORIGIN.trim()).origin } : {}),
    hubWebOrigin: source.AEVO_HUB_WEB_URL?.trim() || "http://localhost:4330",
    coreApiOrigin: source.AEVO_CORE_API_ORIGIN?.trim() || source.AEVO_CORE_API_URL?.trim() || "http://localhost:5099",
    ...(source.AEVO_CORE_API_SERVICE_SECRET?.trim() ? { coreApiServiceSecret: source.AEVO_CORE_API_SERVICE_SECRET.trim() } : {}),
    ...(source.AEVO_ACCOUNTS_API_URL?.trim() ? { accountsApiOrigin: source.AEVO_ACCOUNTS_API_URL.trim() } : {}),
    ...(source.AEVO_ACCOUNTS_EXCHANGE_SECRET?.trim() ? { accountsExchangeSecret: source.AEVO_ACCOUNTS_EXCHANGE_SECRET.trim() } : {}),
    supabaseUrl: normalizedSupabaseUrl!,
    supabaseKey,
    sessionCookieName: sessionCookieName(source.SESSION_COOKIE_NAME ?? "aevo_session"),
    sessionCookieSecret: source.SESSION_COOKIE_SECRET?.trim() || supabaseKey,
    sessionIdleTimeoutSeconds: positiveInteger(source.SESSION_IDLE_TIMEOUT_SECONDS ?? String(60 * 60 * 24 * 7), "SESSION_IDLE_TIMEOUT_SECONDS"),
    sessionAbsoluteTimeoutSeconds: positiveInteger(source.SESSION_ABSOLUTE_TIMEOUT_SECONDS ?? String(60 * 60 * 24 * 30), "SESSION_ABSOLUTE_TIMEOUT_SECONDS"),
    csrfCookieName: sessionCookieName(source.CSRF_COOKIE_NAME ?? "aevo_pos_csrf"),
    sessionCookieSameSite: configuredCookieSameSite,
    logLevel: logLevel as LogLevel,
    stripeSecretKey: source.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: source.STRIPE_WEBHOOK_SECRET?.trim() || undefined
  };
}
