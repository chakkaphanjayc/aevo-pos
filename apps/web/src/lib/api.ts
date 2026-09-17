// Production uses the same Cloudflare Worker for static assets and API, so a
// relative URL is the safest default. Set PUBLIC_API_URL only for local
// development with a separately running API.
const API_URL = (import.meta.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");

function deviceTokenHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("aevo.device.session.v1");
    if (!raw) return {};
    const session = JSON.parse(raw) as { deviceToken?: string };
    return session.deviceToken ? { "x-device-token": session.deviceToken } : {};
  } catch {
    return {};
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const request = () => {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    for (const [key, value] of Object.entries(deviceTokenHeader())) headers.set(key, value);
    if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers });
  };

  let response: Response;
  try {
    response = await request();
    // Supabase access tokens are short-lived by design. Rotate the refresh
    // token once and retry the original request so a staff session remains
    // usable without storing tokens in browser JavaScript.
    if (response.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/refresh") {
      const refreshed = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" }
      });
      if (refreshed.ok) response = await request();
    }
  } catch {
    throw new ApiError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง", 0, "NETWORK_ERROR");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; requestId?: string } } | null;
    throw new ApiError(
      payload?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      payload?.error?.code ?? "HTTP_ERROR",
      payload?.error?.requestId
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

api.get = <T>(path: string, init?: RequestInit): Promise<T> =>
  api<T>(path, { ...init, method: "GET" });

api.post = <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  api<T>(path, { ...init, method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

api.patch = <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  api<T>(path, { ...init, method: "PATCH", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

api.delete = <T>(path: string, init?: RequestInit): Promise<T> =>
  api<T>(path, { ...init, method: "DELETE" });

/** api() with an auto-generated or custom Idempotency-Key header. */
export function apiWithIdempotency<T>(path: string, method: string, body: unknown, key?: string): Promise<T> {
  return api<T>(path, {
    method,
    body: JSON.stringify(body),
    headers: { "idempotency-key": key || crypto.randomUUID() }
  });
}
