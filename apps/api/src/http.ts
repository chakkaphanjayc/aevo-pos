export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export type SameSite = "lax" | "strict" | "none";
function sameSiteAttribute(sameSite: SameSite): string {
  return sameSite === "lax" ? "Lax" : sameSite === "strict" ? "Strict" : "None";
}

export function sessionCookie(name: string, value: string, expiresAt: Date, secure: boolean, sameSite: SameSite = "lax"): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSiteAttribute(sameSite)}; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(name: string, secure: boolean, sameSite: SameSite = "lax"): string {
  return `${name}=; Path=/; HttpOnly; SameSite=${sameSiteAttribute(sameSite)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function clientIp(request: Request): string | undefined {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
}
